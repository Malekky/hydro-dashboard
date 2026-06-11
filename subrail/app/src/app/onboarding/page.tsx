'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { erc20Abi, formatUnits, type Hash } from 'viem';
import {
  useAccount, useConnect, useReadContract, useSendTransaction, useWalletClient, useWriteContract,
} from 'wagmi';
import {
  captureBuyerPayment, createPeerClient, fulfillWithCapture, getBestOnrampQuote,
  openPeerExtensionInstallPage, peerExtensionReady, signalQuotedIntent,
} from '@/lib/onramp/peer';
import { USDC_ADDRESS, USDC_DECIMALS, usdToUnits } from '@/lib/chain/usdc';
import { PLAN_FACE_USD, type ClaudePlan, type PeerPlatform } from '@/lib/types';
import { AddressChip, Alert, Button, QrCode, Stepper } from '@/components/ui';
import type { FundingQuote } from '@/lib/gateway/funding';
import type { QuoteSingleResponse } from '@zkp2p/sdk';

const PLAN_NAMES: Record<ClaudePlan, string> = { pro: 'Pro', max5x: 'Max 5x', max20x: 'Max 20x' };
const PLATFORM_LABELS: Partial<Record<PeerPlatform, string>> = {
  venmo: 'Venmo', cashapp: 'Cash App', zelle: 'Zelle', paypal: 'PayPal', revolut: 'Revolut',
  wise: 'Wise', monzo: 'Monzo', n26: 'N26', mercado_pago: 'Mercado Pago', alipay: 'Alipay',
  chime: 'Chime', luxon: 'Luxon',
};

export default function OnboardingPage() {
  return (
    <Suspense>
      <Onboarding />
    </Suspense>
  );
}

function Onboarding() {
  const params = useSearchParams();
  const plan = (params.get('plan') ?? 'pro') as ClaudePlan;
  const platform = (params.get('platform') || null) as PeerPlatform | null;
  const faceUsd = PLAN_FACE_USD[plan] ?? 20;
  /** One cycle + 5% headroom for bridge/swap + FX drag. */
  const cycleUsd = Math.ceil(faceUsd * 1.05 * 100) / 100;

  const { address, isConnected } = useAccount();
  const balance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 5_000 },
  });
  const balanceUsd = balance.data !== undefined ? Number(formatUnits(balance.data, USDC_DECIMALS)) : 0;
  const funded = balanceUsd >= cycleUsd;

  const [contributed, setContributed] = useState(false);
  const step = !isConnected ? 0 : !funded && !contributed ? 1 : !contributed ? 2 : 3;

  return (
    <main>
      <div style={{ paddingTop: '1.6rem' }}>
        <h1>
          Claude {PLAN_NAMES[plan]}
          <span style={{ color: 'var(--muted)', fontWeight: 500, fontSize: '0.7em' }}> · ${faceUsd}/month</span>
        </h1>
      </div>
      <Stepper labels={['Wallet', 'Fund', 'Contribute', 'Done']} current={step} />

      {step === 0 && <ConnectStep />}
      {step === 1 && address && (
        <FundStep wallet={address} platform={platform} targetUsd={cycleUsd} balanceUsd={balanceUsd} />
      )}
      {step === 2 && address && (
        <ContributeStep wallet={address} cycleUsd={cycleUsd} balanceUsd={balanceUsd} onDone={() => setContributed(true)} />
      )}
      {step === 3 && (
        <section className="card recommended">
          <h2>You’re covered</h2>
          <p>
            Your contribution is on its way to the gateway. The gateway card keeps your
            claude.ai subscription paid, and your operator will confirm your plan is
            active. Come back anytime to add more months.
          </p>
          <dl className="kv">
            <dt>Wallet balance</dt>
            <dd>${balanceUsd.toFixed(2)} USDC</dd>
          </dl>
        </section>
      )}
    </main>
  );
}

function ConnectStep() {
  const { connect, connectors, isPending, error } = useConnect();
  const coinbase = connectors.find((c) => c.id === 'coinbaseWalletSDK') ?? connectors[0];
  return (
    <section className="card">
      <h2>Create your wallet</h2>
      <p style={{ color: 'var(--ink-2)' }}>
        A smart wallet secured by your device’s passkey — Face ID or fingerprint, no seed
        phrase to lose. Your money stays yours until you decide to contribute it.
      </p>
      <Button loading={isPending} disabled={!coinbase} onClick={() => coinbase && connect({ connector: coinbase })}>
        {isPending ? 'Waiting for passkey' : 'Create or connect wallet'}
      </Button>
      {error && <Alert kind="err">{error.message}</Alert>}
      <p className="hint" style={{ marginTop: '0.75rem' }}>
        Already have one? The same button signs you back in.
      </p>
    </section>
  );
}

function FundStep({ wallet, platform, targetUsd, balanceUsd }: {
  wallet: `0x${string}`; platform: PeerPlatform | null; targetUsd: number; balanceUsd: number;
}) {
  const { data: walletClient } = useWalletClient();
  const hasExtension = useMemo(() => peerExtensionReady(), []);
  const [quote, setQuote] = useState<QuoteSingleResponse | null>(null);
  const [intentHash, setIntentHash] = useState<Hash | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const peer = useMemo(() => (walletClient ? createPeerClient(walletClient) : null), [walletClient]);
  const platformName = platform ? (PLATFORM_LABELS[platform] ?? platform) : null;
  const progress = Math.min(100, Math.round((balanceUsd / targetUsd) * 100));

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2 style={{ margin: 0 }}>Fund your wallet</h2>
        <span className="badge badge-neutral">{progress}% there</span>
      </div>
      <dl className="kv">
        <dt>You have</dt>
        <dd>${balanceUsd.toFixed(2)} USDC</dd>
      </dl>
      <dl className="kv">
        <dt>You need (1 month)</dt>
        <dd>${targetUsd.toFixed(2)} USDC</dd>
      </dl>
      <p className="hint">Tip: fund a few months at once and contribute them in one go.</p>
      <hr className="divider" />

      {platform && (
        <div style={{ marginBottom: '1.1rem' }}>
          <h3>Pay with {platformName}</h3>
          {!hasExtension ? (
            <>
              <p style={{ color: 'var(--ink-2)' }}>
                The Peer extension for desktop Chrome verifies your {platformName} payment
                privately — no screenshots, no support tickets.
              </p>
              <Button variant="secondary" onClick={() => openPeerExtensionInstallPage()}>
                Install the Peer extension
              </Button>
              <p className="hint" style={{ marginTop: '0.6rem' }}>
                On your phone? Use the Peer app to onramp straight to your address below.
              </p>
            </>
          ) : !quote ? (
            <Button
              loading={busy !== null}
              disabled={!peer}
              onClick={() => run('quote', async () => {
                const q = await getBestOnrampQuote(peer!, {
                  platform, fiatCurrency: 'USD', usd: targetUsd, recipient: wallet,
                });
                if (!q) throw new Error(`No liquidity on ${platformName} right now — try the deposit option below, or check back shortly.`);
                setQuote(q);
              })}
            >
              {busy ? 'Finding the best rate' : `Get a ${platformName} quote`}
            </Button>
          ) : !intentHash ? (
            <>
              <dl className="kv">
                <dt>You pay</dt>
                <dd>{quote.fiatAmountFormatted}</dd>
              </dl>
              <dl className="kv">
                <dt>You receive</dt>
                <dd>{quote.tokenAmountFormatted} USDC</dd>
              </dl>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <Button loading={busy !== null} onClick={() => run('lock', async () => {
                  setIntentHash(await signalQuotedIntent(peer!, quote, wallet));
                })}>
                  {busy ? 'Locking your rate' : 'Lock rate & continue'}
                </Button>
                <Button variant="ghost" disabled={busy !== null} onClick={() => setQuote(null)}>
                  New quote
                </Button>
              </div>
            </>
          ) : (
            <>
              <Alert kind="info">
                Rate locked. Pay <strong>{quote.fiatAmountFormatted}</strong> to the seller in your{' '}
                {platformName} app, then come back here.
              </Alert>
              <Button loading={busy !== null} onClick={() => run('verify', async () => {
                const capture = await captureBuyerPayment(platform);
                await fulfillWithCapture(peer!, { intentHash: intentHash as `0x${string}`, capture, platform });
              })}>
                {busy ? 'Verifying your payment' : 'I’ve paid — verify & receive USDC'}
              </Button>
            </>
          )}
        </div>
      )}

      <div>
        <h3>{platform ? 'Or deposit USDC directly' : 'Deposit USDC'}</h3>
        <p style={{ color: 'var(--ink-2)', fontSize: '0.9rem' }}>
          Send USDC on <strong>Base</strong> from any exchange or the Peer app. Your balance
          updates here automatically.
        </p>
        <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <QrCode value={wallet} />
          <div style={{ flex: '1 1 240px' }}>
            <AddressChip value={wallet} />
            <p className="hint" style={{ marginTop: '0.4rem' }}>
              Base network only — sending on other networks can lose funds.
            </p>
          </div>
        </div>
      </div>

      {error && <Alert kind="err">{error}</Alert>}
    </section>
  );
}

function ContributeStep({ wallet, cycleUsd, balanceUsd, onDone }: {
  wallet: `0x${string}`; cycleUsd: number; balanceUsd: number; onDone: () => void;
}) {
  const [months, setMonths] = useState(1);
  const [gateway, setGateway] = useState<{ configured: boolean; safeAddress?: string } | null>(null);
  const [quote, setQuote] = useState<FundingQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const usd = Math.min(Math.round(cycleUsd * months * 100) / 100, Math.floor(balanceUsd * 100) / 100);
  const affordableMonths = Math.floor(balanceUsd / cycleUsd);
  const enough = balanceUsd >= cycleUsd * months;

  useEffect(() => {
    fetch('/api/gateway/status')
      .then(async (r) => setGateway(await r.json()))
      .catch(() => setGateway({ configured: false }));
  }, []);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (gateway && !gateway.configured) {
    return (
      <section className="card">
        <h2>One moment — gateway not connected</h2>
        <Alert kind="warn">
          Your operator hasn’t connected their Gnosis Pay account yet. Ask them to set{' '}
          <code>GNOSIS_OPERATOR_PRIVATE_KEY</code> and <code>GNOSIS_SAFE_ADDRESS</code> —
          it takes two minutes and needs no approval from anyone.
        </Alert>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Contribute to your gateway</h2>
      <p style={{ color: 'var(--ink-2)' }}>
        One transaction routes your USDC to the gateway, where it pays your claude.ai
        subscription. You’re trusting your operator — that’s the arrangement between
        friends.
      </p>

      <label className="field">
        <span>Months to cover</span>
        <select
          className="input"
          value={months}
          onChange={(e) => { setMonths(Number(e.target.value)); setQuote(null); }}
        >
          {[1, 3, 6].map((m) => (
            <option key={m} value={m}>
              {m} month{m > 1 ? 's' : ''} — ${(cycleUsd * m).toFixed(2)}
            </option>
          ))}
        </select>
      </label>

      {!enough && (
        <Alert kind="warn">
          Your balance covers {affordableMonths} month{affordableMonths === 1 ? '' : 's'}. Pick
          fewer months or go back and top up.
        </Alert>
      )}

      {!quote ? (
        <Button
          loading={busy}
          disabled={!gateway?.configured || !enough}
          onClick={() => run(async () => {
            const res = await fetch('/api/gateway/funding-quote', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ friendWallet: wallet, usd }),
            });
            if (!res.ok) throw new Error((await res.json()).error ?? `Route lookup failed (${res.status})`);
            setQuote(await res.json());
          })}
        >
          {busy ? 'Finding the route' : 'Review contribution'}
        </Button>
      ) : (
        <>
          <dl className="kv">
            <dt>You send</dt>
            <dd>${usd.toFixed(2)} USDC</dd>
          </dl>
          <dl className="kv">
            <dt>Gateway receives</dt>
            <dd>≈ €{(Number(quote.estimatedEure) / 1e18).toFixed(2)}</dd>
          </dl>
          {quote.toolName && <p className="hint">Routed by {quote.toolName} · delivered straight to the gateway, nothing held in between.</p>}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem' }}>
            <Button
              loading={busy}
              onClick={() => run(async () => {
                if (quote.approvalAddress) {
                  await writeContractAsync({
                    address: USDC_ADDRESS,
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [quote.approvalAddress, usdToUnits(usd)],
                  });
                }
                await sendTransactionAsync({
                  to: quote.transactionRequest.to,
                  data: quote.transactionRequest.data,
                  value: quote.transactionRequest.value ? BigInt(quote.transactionRequest.value) : undefined,
                });
                onDone();
              })}
            >
              {busy ? 'Confirm in your wallet' : `Contribute $${usd.toFixed(2)}`}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setQuote(null)}>
              Change amount
            </Button>
          </div>
        </>
      )}

      {error && <Alert kind="err">{error}</Alert>}
    </section>
  );
}
