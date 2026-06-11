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
import type { FundingQuote } from '@/lib/gateway/funding';
import type { QuoteSingleResponse } from '@zkp2p/sdk';

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
      <h1 style={{ fontSize: '1.4rem' }}>Claude {plan} via the gateway — ${faceUsd}/mo</h1>
      <Stepper step={step} />
      {step === 0 && <ConnectStep />}
      {step === 1 && address && (
        <FundStep wallet={address} platform={platform} targetUsd={cycleUsd} balanceUsd={balanceUsd} />
      )}
      {step === 2 && address && (
        <ContributeStep wallet={address} cycleUsd={cycleUsd} balanceUsd={balanceUsd} onDone={() => setContributed(true)} />
      )}
      {step === 3 && (
        <section style={card}>
          <h2>You’re covered 🎉</h2>
          <p>
            Your contribution is on its way to the gateway. Your operator’s card keeps your
            claude.ai subscription paid — they’ll confirm your plan is active. Come back
            anytime to top up more months.
          </p>
        </section>
      )}
    </main>
  );
}

function Stepper({ step }: { step: number }) {
  const labels = ['Wallet', 'Fund', 'Contribute', 'Done'];
  return (
    <ol style={{ display: 'flex', gap: '1rem', listStyle: 'none', padding: 0, fontSize: '0.85rem' }}>
      {labels.map((l, i) => (
        <li key={l} style={{ fontWeight: i === step ? 700 : 400, color: i < step ? '#2f6f4f' : i === step ? '#1a1a18' : '#999' }}>
          {i < step ? '✓ ' : `${i + 1}. `}{l}
        </li>
      ))}
    </ol>
  );
}

function ConnectStep() {
  const { connect, connectors, isPending, error } = useConnect();
  const coinbase = connectors.find((c) => c.id === 'coinbaseWalletSDK') ?? connectors[0];
  return (
    <section style={card}>
      <h2>Create your wallet</h2>
      <p>A passkey smart wallet on Base — no seed phrase. Your funds stay yours until you contribute.</p>
      <button style={cta} disabled={isPending || !coinbase} onClick={() => coinbase && connect({ connector: coinbase })}>
        {isPending ? 'Opening passkey…' : 'Create / connect smart wallet'}
      </button>
      {error && <p style={err}>{error.message}</p>}
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
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const peer = useMemo(
    () => (walletClient ? createPeerClient(walletClient) : null),
    [walletClient],
  );

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setStatus(label);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
    }
  }

  return (
    <section style={card}>
      <h2>Fund your wallet</h2>
      <p>
        Balance: <strong>${balanceUsd.toFixed(2)}</strong> · needed: <strong>${targetUsd.toFixed(2)}</strong> USDC
        <span style={{ color: '#666' }}> (fund several months at once to contribute them in one go)</span>
      </p>

      {platform && (
        <div style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1rem' }}>Option A — Pay with {platform.replace('_', ' ')} (Peer)</h3>
          {!hasExtension ? (
            <>
              <p>The Peer extension (desktop Chrome) verifies your payment trustlessly.</p>
              <button style={cta} onClick={() => openPeerExtensionInstallPage()}>Install Peer extension</button>
              <p style={{ fontSize: '0.85rem', color: '#666' }}>
                On mobile? Use the Peer app to onramp to your address below instead.
              </p>
            </>
          ) : !quote ? (
            <button
              style={cta}
              disabled={!peer || status !== null}
              onClick={() => run('Fetching quote…', async () => {
                const q = await getBestOnrampQuote(peer!, {
                  platform, fiatCurrency: 'USD', usd: targetUsd, recipient: wallet,
                });
                if (!q) throw new Error('No maker liquidity for this corridor right now — try the deposit option.');
                setQuote(q);
              })}
            >
              Get a quote
            </button>
          ) : !intentHash ? (
            <>
              <p>
                Pay <strong>{quote.fiatAmountFormatted}</strong> → receive <strong>{quote.tokenAmountFormatted} USDC</strong>
              </p>
              <button
                style={cta}
                disabled={status !== null}
                onClick={() => run('Locking escrow…', async () => {
                  setIntentHash(await signalQuotedIntent(peer!, quote, wallet));
                })}
              >
                Lock rate & start
              </button>
            </>
          ) : (
            <>
              <p>
                Escrow locked. Now pay <strong>{quote.fiatAmountFormatted}</strong> to the maker on{' '}
                {platform.replace('_', ' ')}, then verify:
              </p>
              <button
                style={cta}
                disabled={status !== null}
                onClick={() => run('Verifying payment in TEE…', async () => {
                  const capture = await captureBuyerPayment(platform);
                  await fulfillWithCapture(peer!, { intentHash: intentHash as `0x${string}`, capture, platform });
                })}
              >
                I’ve paid — verify & receive USDC
              </button>
            </>
          )}
        </div>
      )}

      <div>
        <h3 style={{ fontSize: '1rem' }}>Option {platform ? 'B' : 'A'} — Deposit USDC directly</h3>
        <p style={{ fontSize: '0.9rem' }}>
          Send USDC on <strong>Base</strong> to your wallet from any exchange or the Peer app:
        </p>
        <code style={{ display: 'block', padding: '0.5rem', background: '#f2f2ee', borderRadius: 6, wordBreak: 'break-all' }}>
          {wallet}
        </code>
        <p style={{ fontSize: '0.8rem', color: '#666' }}>Balance refreshes automatically.</p>
      </div>

      {status && <p>{status}</p>}
      {error && <p style={err}>{error}</p>}
    </section>
  );
}

function ContributeStep({ wallet, cycleUsd, balanceUsd, onDone }: {
  wallet: `0x${string}`; cycleUsd: number; balanceUsd: number; onDone: () => void;
}) {
  const [months, setMonths] = useState(1);
  const [gateway, setGateway] = useState<{ configured: boolean; safeAddress?: string } | null>(null);
  const [quote, setQuote] = useState<FundingQuote | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();

  const usd = Math.min(Math.round(cycleUsd * months * 100) / 100, Math.floor(balanceUsd * 100) / 100);
  const enough = balanceUsd >= cycleUsd * months;

  useEffect(() => {
    fetch('/api/gateway/status').then(async (r) => setGateway(await r.json())).catch(() => setGateway({ configured: false }));
  }, []);

  async function run(label: string, fn: () => Promise<void>) {
    setError(null);
    setStatus(label);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
    }
  }

  if (gateway && !gateway.configured) {
    return (
      <section style={{ ...card, borderColor: '#b58900' }}>
        <h2>Gateway not configured</h2>
        <p>
          The operator hasn’t connected their Gnosis Pay account yet
          (<code>GNOSIS_OPERATOR_PRIVATE_KEY</code> + <code>GNOSIS_SAFE_ADDRESS</code>).
          No partnership needed — the permissionless tier works with the operator’s own
          SIWE key (docs.gnosispay.com/integration-model).
        </p>
      </section>
    );
  }

  return (
    <section style={card}>
      <h2>Contribute to the gateway</h2>
      <p style={{ fontSize: '0.9rem' }}>
        Your USDC routes to the operator’s Gnosis Pay Safe as EURe (one transaction, via
        LI.FI). Their card then keeps your claude.ai subscription paid. You’re trusting
        your operator — that’s the deal among friends.
      </p>
      <label style={row}>
        Months to cover
        <select value={months} onChange={(e) => { setMonths(Number(e.target.value)); setQuote(null); }}>
          {[1, 3, 6].map((m) => <option key={m} value={m}>{m} month{m > 1 ? 's' : ''} (${(cycleUsd * m).toFixed(2)})</option>)}
        </select>
      </label>
      {!enough && <p style={err}>Balance covers {Math.floor(balanceUsd / cycleUsd)} month(s) — top up or pick fewer months.</p>}

      {!quote ? (
        <button
          style={cta}
          disabled={!gateway?.configured || !enough || status !== null}
          onClick={() => run('Routing Base USDC → Gnosis EURe…', async () => {
            const res = await fetch('/api/gateway/funding-quote', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ friendWallet: wallet, usd }),
            });
            if (!res.ok) throw new Error((await res.json()).error ?? `quote failed (${res.status})`);
            setQuote(await res.json());
          })}
        >
          Get route
        </button>
      ) : (
        <>
          <p style={{ fontSize: '0.9rem' }}>
            ${usd.toFixed(2)} USDC → ≈{(Number(quote.estimatedEure) / 1e18).toFixed(2)} EURe
            {quote.toolName ? ` via ${quote.toolName}` : ''}, delivered straight to the Safe.
          </p>
          <button
            style={cta}
            disabled={status !== null}
            onClick={() => run('Confirm in wallet…', async () => {
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
            {quote.approvalAddress ? 'Approve & contribute' : 'Contribute'}
          </button>
        </>
      )}

      {status && <p>{status}</p>}
      {error && <p style={err}>{error}</p>}
    </section>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBlock: '1rem', background: '#fff',
};
const row: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', gap: '1rem',
};
const cta: React.CSSProperties = {
  background: '#2f6f4f', color: '#fff', border: 'none', borderRadius: 6,
  padding: '0.55rem 1.1rem', cursor: 'pointer', fontSize: '0.95rem',
};
const err: React.CSSProperties = { color: '#8a1f11', fontSize: '0.85rem' };
