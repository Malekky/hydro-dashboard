'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { erc20Abi, formatUnits, type Hex } from 'viem';
import {
  useAccount, useConnect, useReadContract, useWatchContractEvent, useWriteContract,
} from 'wagmi';
import { USDC_ADDRESS, USDC_DECIMALS } from '@/lib/chain/usdc';
import {
  ESCROW_STATE, GIFT_ESCROW_ABI, PLAN_RANK, escrowAddress, newIntentId,
} from '@/lib/solver/escrow';
import { faceUsdc, hashEmail, requiredLock, type GiftMonths } from '@/lib/solver/intent';
import { PLAN_FACE_USD, type ClaudePlan } from '@/lib/types';
import { AddressChip, Alert, Button, Stepper } from '@/components/ui';

const PLAN_NAMES: Record<ClaudePlan, string> = { pro: 'Pro', max5x: 'Max 5x', max20x: 'Max 20x' };
const SPREAD_BPS = 500; // 5% solver spread (matches doc economics; tune later)
const EXPIRY_HOURS = 48;

export default function SubscribePage() {
  return (
    <Suspense>
      <Subscribe />
    </Suspense>
  );
}

function Subscribe() {
  const params = useSearchParams();
  const initialPlan = (params.get('plan') ?? 'pro') as ClaudePlan;
  const escrow = escrowAddress();

  const { address, isConnected } = useAccount();
  const [plan, setPlan] = useState<ClaudePlan>(initialPlan);
  const [months, setMonths] = useState<GiftMonths>(3);
  const [email, setEmail] = useState('');
  const [intentId, setIntentId] = useState<Hex | null>(null);

  const lock = requiredLock(plan, months, SPREAD_BPS);
  const lockUsd = Number(lock) / 10 ** USDC_DECIMALS;
  const faceUsd = Number(faceUsdc(plan, months)) / 10 ** USDC_DECIMALS;

  const step = !isConnected ? 0 : !intentId ? 1 : 2;

  if (!escrow) {
    return (
      <main>
        <PageHead />
        <section className="card">
          <Alert kind="warn">
            The escrow contract isn’t deployed yet. Set{' '}
            <code>NEXT_PUBLIC_GIFT_ESCROW_ADDRESS</code> (deploy{' '}
            <code>contracts/GiftIntentEscrow.sol</code> on Base) and restart.
          </Alert>
        </section>
      </main>
    );
  }

  return (
    <main>
      <PageHead />
      <Stepper labels={['Wallet', 'Open order', 'Fulfilled']} current={step} />

      {step === 0 && <ConnectStep />}

      {step === 1 && address && (
        <OpenIntent
          escrow={escrow}
          wallet={address}
          plan={plan}
          months={months}
          email={email}
          lock={lock}
          lockUsd={lockUsd}
          faceUsd={faceUsd}
          onPlan={setPlan}
          onMonths={setMonths}
          onEmail={setEmail}
          onOpened={setIntentId}
        />
      )}

      {step === 2 && intentId && escrow && (
        <TrackIntent escrow={escrow} intentId={intentId} email={email} plan={plan} months={months} />
      )}
    </main>
  );
}

function PageHead() {
  return (
    <div style={{ padding: '1.6rem 0 0.25rem' }}>
      <h1>Get Claude, paid by a solver</h1>
      <p style={{ color: 'var(--ink-2)' }}>
        Lock USDC with the plan and the email you want it gifted to. A solver buys the
        official gift, proves the purchase, and the escrow pays them. If nobody fulfills,
        you reclaim your USDC.
      </p>
    </div>
  );
}

function ConnectStep() {
  const { connect, connectors, isPending, error } = useConnect();
  const coinbase = connectors.find((c) => c.id === 'coinbaseWalletSDK') ?? connectors[0];
  return (
    <section className="card">
      <h2>Connect your wallet</h2>
      <p style={{ color: 'var(--ink-2)' }}>
        A passkey smart wallet on Base. You’ll need USDC in it to open an order — fund it
        from any exchange or wallet (onramp coming soon).
      </p>
      <Button loading={isPending} disabled={!coinbase} onClick={() => coinbase && connect({ connector: coinbase })}>
        {isPending ? 'Waiting for passkey' : 'Connect wallet'}
      </Button>
      {error && <Alert kind="err">{error.message}</Alert>}
    </section>
  );
}

function OpenIntent(props: {
  escrow: `0x${string}`;
  wallet: `0x${string}`;
  plan: ClaudePlan;
  months: GiftMonths;
  email: string;
  lock: bigint;
  lockUsd: number;
  faceUsd: number;
  onPlan: (p: ClaudePlan) => void;
  onMonths: (m: GiftMonths) => void;
  onEmail: (e: string) => void;
  onOpened: (id: `0x${string}`) => void;
}) {
  const { escrow, wallet, plan, months, email, lock, lockUsd, faceUsd } = props;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();

  const balance = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf',
    args: [wallet], query: { refetchInterval: 5_000 },
  });
  const balanceUsd = balance.data !== undefined ? Number(formatUnits(balance.data, USDC_DECIMALS)) : 0;
  const allowance = useReadContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: 'allowance',
    args: [wallet, escrow], query: { refetchInterval: 5_000 },
  });
  const approved = (allowance.data ?? 0n) >= lock;
  const funded = balanceUsd >= lockUsd;
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(label);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  return (
    <section className="card">
      <h2>Your order</h2>

      <div className="field">
        <span>Plan</span>
        <div className="radio-cards" role="radiogroup">
          {(Object.keys(PLAN_NAMES) as ClaudePlan[]).map((p) => (
            <label key={p} className="radio-card" data-checked={plan === p}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <input type="radio" name="plan" checked={plan === p} onChange={() => props.onPlan(p)} />
                <strong>{PLAN_NAMES[p]}</strong>
              </span>
              <span className="price">${PLAN_FACE_USD[p]}/mo</span>
            </label>
          ))}
        </div>
      </div>

      <label className="field">
        <span>Duration</span>
        <select className="input" value={months} onChange={(e) => props.onMonths(Number(e.target.value) as GiftMonths)}>
          {[3, 6, 12].map((m) => <option key={m} value={m}>{m} months</option>)}
        </select>
      </label>

      <label className="field">
        <span>Recipient email <small>(where Anthropic sends the gift)</small></span>
        <input className="input" type="email" value={email} placeholder="you@example.com"
          onChange={(e) => props.onEmail(e.target.value)} />
      </label>

      <dl className="kv"><dt>Gift face price</dt><dd>${faceUsd.toFixed(2)}</dd></dl>
      <dl className="kv"><dt>Solver spread (5%)</dt><dd>${(lockUsd - faceUsd).toFixed(2)}</dd></dl>
      <dl className="kv" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.4rem' }}>
        <dt><strong>You lock</strong></dt><dd><strong>${lockUsd.toFixed(2)} USDC</strong></dd>
      </dl>

      {!funded && (
        <Alert kind="warn">
          Your wallet has ${balanceUsd.toFixed(2)} USDC — fund it with at least ${lockUsd.toFixed(2)} to continue.
        </Alert>
      )}

      <hr className="divider" />

      {!approved ? (
        <Button
          loading={busy === 'approve'}
          disabled={!emailValid || !funded}
          onClick={() => run('approve', async () => {
            await writeContractAsync({
              address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [escrow, lock],
            });
          })}
        >
          {busy === 'approve' ? 'Confirm in wallet' : `Approve $${lockUsd.toFixed(2)} USDC`}
        </Button>
      ) : (
        <Button
          loading={busy === 'open'}
          disabled={!emailValid || !funded}
          onClick={() => run('open', async () => {
            const id = newIntentId();
            const expiry = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_HOURS * 3600);
            await writeContractAsync({
              address: escrow, abi: GIFT_ESCROW_ABI, functionName: 'open',
              args: [id, lock, hashEmail(email), PLAN_RANK[plan], months, expiry],
            });
            props.onOpened(id);
          })}
        >
          {busy === 'open' ? 'Confirm in wallet' : 'Open order & lock USDC'}
        </Button>
      )}

      <p className="hint" style={{ marginTop: '0.6rem' }}>
        Unfilled after {EXPIRY_HOURS}h? You reclaim every cent. The solver is paid only on a
        valid proof that the gift went to <em>{emailValid ? email : 'your email'}</em>.
      </p>
      {error && <Alert kind="err">{error}</Alert>}
    </section>
  );
}

function TrackIntent({ escrow, intentId, email, plan, months }: {
  escrow: `0x${string}`; intentId: `0x${string}`; email: string; plan: ClaudePlan; months: GiftMonths;
}) {
  const [fulfilled, setFulfilled] = useState(false);
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intent = useReadContract({
    address: escrow, abi: GIFT_ESCROW_ABI, functionName: 'intents',
    args: [intentId], query: { refetchInterval: 8_000 },
  });
  const stateName = intent.data ? ESCROW_STATE[Number(intent.data[7])] : undefined;
  const expiry = intent.data ? Number(intent.data[6]) : 0;
  const expired = expiry > 0 && Date.now() / 1000 > expiry;

  useWatchContractEvent({
    address: escrow, abi: GIFT_ESCROW_ABI, eventName: 'IntentFulfilled',
    args: { id: intentId }, onLogs: () => setFulfilled(true),
  });

  const done = fulfilled || stateName === 'fulfilled';

  return (
    <section className="card recommended">
      {done ? (
        <>
          <h2>Gifted 🎉</h2>
          <p>
            A solver bought your Claude {PLAN_NAMES[plan]} ({months} months) and proved it.
            Check <strong>{email}</strong> for the gift from Anthropic, then redeem it at
            claude.ai/gift/redeem.
          </p>
        </>
      ) : (
        <>
          <h2>Waiting for a solver…</h2>
          <p style={{ color: 'var(--ink-2)' }}>
            Your order is live and your USDC is locked in escrow. A solver will buy the gift
            for <strong>{email}</strong> and prove it — usually minutes. This page updates
            automatically.
          </p>
          <dl className="kv"><dt>Order</dt><dd style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>{intentId.slice(0, 10)}…</dd></dl>
          <dl className="kv"><dt>Status</dt><dd>{stateName ?? 'confirming…'}</dd></dl>
          {expired && stateName === 'open' && (
            <>
              <Alert kind="warn">No solver filled this in time. Reclaim your USDC below.</Alert>
              <Button
                loading={busy}
                onClick={async () => {
                  setBusy(true); setError(null);
                  try {
                    await writeContractAsync({ address: escrow, abi: GIFT_ESCROW_ABI, functionName: 'refund', args: [intentId] });
                  } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
                  finally { setBusy(false); }
                }}
              >
                {busy ? 'Confirm in wallet' : 'Reclaim my USDC'}
              </Button>
            </>
          )}
          {error && <Alert kind="err">{error}</Alert>}
        </>
      )}
      <div style={{ marginTop: '0.8rem' }}>
        <AddressChip value={intentId} />
      </div>
    </section>
  );
}
