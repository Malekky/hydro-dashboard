'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { erc20Abi, formatUnits, type Hash } from 'viem';
import {
  useAccount, useConnect, useDisconnect, useReadContract, useWalletClient, useWriteContract,
} from 'wagmi';
import {
  captureBuyerPayment, createPeerClient, fulfillWithCapture, getBestOnrampQuote,
  openPeerExtensionInstallPage, peerExtensionReady, signalQuotedIntent,
} from '@/lib/onramp/peer';
import { USDC_ADDRESS, USDC_DECIMALS, usdToUnits } from '@/lib/chain/usdc';
import { PLAN_FACE_USD, type ClaudePlan, type PeerPlatform } from '@/lib/types';
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
  /** One cycle + 5% headroom for spreads/fees at auth time. */
  const targetUsd = Math.ceil(faceUsd * 1.05 * 100) / 100;

  const { address, isConnected } = useAccount();
  const balance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 5_000 },
  });
  const balanceUsd = balance.data !== undefined ? Number(formatUnits(balance.data, USDC_DECIMALS)) : 0;
  const funded = balanceUsd >= targetUsd;

  const [cardDone, setCardDone] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  const step = !isConnected ? 0 : !funded ? 1 : !cardDone ? 2 : !subscribed ? 3 : 4;

  return (
    <main>
      <h1 style={{ fontSize: '1.4rem' }}>Set up Claude {plan} — ${faceUsd}/mo</h1>
      <Stepper step={step} />
      {step === 0 && <ConnectStep />}
      {step === 1 && address && (
        <FundStep wallet={address} platform={platform} targetUsd={targetUsd} balanceUsd={balanceUsd} />
      )}
      {step === 2 && address && (
        <CardStep wallet={address} cycleUsd={targetUsd} onDone={() => setCardDone(true)} />
      )}
      {step === 3 && <SubscribeStep onDone={() => setSubscribed(true)} />}
      {step === 4 && (
        <section style={card}>
          <h2>You’re subscribed 🎉</h2>
          <p>
            Your card pulls USDC from your wallet only when Anthropic charges it. Keep
            ≈${targetUsd.toFixed(2)} in the wallet around your billing date. Renewal
            automation ships next.
          </p>
        </section>
      )}
    </main>
  );
}

function Stepper({ step }: { step: number }) {
  const labels = ['Wallet', 'Fund', 'Card', 'Subscribe'];
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
      <p>A passkey smart wallet on Base — no seed phrase. Your funds stay yours.</p>
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

function CardStep({ wallet, cycleUsd, onDone }: {
  wallet: `0x${string}`; cycleUsd: number; onDone: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [kyc, setKyc] = useState<{ customerId: string; kycLink: string } | null>(null);
  const [kycStatus, setKycStatus] = useState<string>('pending');
  const [cardAccount, setCardAccount] = useState<{
    cardAccountId: string; fundingDelegateAddress?: `0x${string}`; cardDetails?: { last4?: string };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const { writeContractAsync, isPending: approving } = useWriteContract();

  useEffect(() => {
    if (!kyc || kycStatus === 'approved') return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/bridge/customers?customerId=${kyc.customerId}`);
      if (res.ok) setKycStatus((await res.json()).status);
    }, 5_000);
    return () => clearInterval(t);
  }, [kyc, kycStatus]);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 503) {
      setNotConfigured(true);
      throw new Error('bridge_not_configured');
    }
    if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
    return res.json();
  }

  if (notConfigured) {
    return (
      <section style={{ ...card, borderColor: '#b58900' }}>
        <h2>Card issuing not configured</h2>
        <p>
          The Bridge card program requires <code>BRIDGE_API_KEY</code> (program/KYB approval —
          apidocs.bridge.xyz). Set it and restart. Fallback rails (app-store gift card / Claude
          gift code) cover the meantime.
        </p>
      </section>
    );
  }

  return (
    <section style={card}>
      <h2>Get your card</h2>
      <p style={{ fontSize: '0.9rem' }}>
        A virtual Visa in <em>your</em> name that pulls USDC from <em>your</em> wallet only when
        charged. Issued by Bridge (a Stripe company) after a quick identity check.
      </p>

      {!kyc ? (
        <>
          <label style={row}>Full legal name <input value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
          <label style={row}>Email <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <button
            style={cta}
            disabled={fullName.length < 2 || !email.includes('@')}
            onClick={async () => {
              try { setKyc(await post('/api/bridge/customers', { fullName, email })); }
              catch (e) { if (!(e instanceof Error && e.message === 'bridge_not_configured')) setError(String(e)); }
            }}
          >
            Start identity check
          </button>
        </>
      ) : kycStatus !== 'approved' ? (
        <>
          <p>Complete verification with Bridge (opens in a new tab):</p>
          <a href={kyc.kycLink} target="_blank" rel="noreferrer" style={{ ...cta, display: 'inline-block', textDecoration: 'none' }}>
            Open verification →
          </a>
          <p style={{ fontSize: '0.85rem', color: '#666' }}>Status: {kycStatus} (checking automatically)</p>
        </>
      ) : !cardAccount ? (
        <button
          style={cta}
          onClick={async () => {
            try {
              setCardAccount(await post('/api/bridge/cards', { customerId: kyc.customerId, walletAddress: wallet }));
            } catch (e) { if (!(e instanceof Error && e.message === 'bridge_not_configured')) setError(String(e)); }
          }}
        >
          Issue my virtual card
        </button>
      ) : (
        <>
          <p>Card issued{cardAccount.cardDetails?.last4 ? ` (•••• ${cardAccount.cardDetails.last4})` : ''}. Last step: allow it to
            pull up to <strong>${cycleUsd.toFixed(2)}</strong> USDC from your wallet when charged.</p>
          {cardAccount.fundingDelegateAddress ? (
            <button
              style={cta}
              disabled={approving}
              onClick={async () => {
                try {
                  await writeContractAsync({
                    address: USDC_ADDRESS,
                    abi: erc20Abi,
                    functionName: 'approve',
                    args: [cardAccount.fundingDelegateAddress!, usdToUnits(cycleUsd)],
                  });
                  onDone();
                } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
              }}
            >
              {approving ? 'Confirm in wallet…' : `Approve $${cycleUsd.toFixed(2)} allowance`}
            </button>
          ) : (
            <p style={err}>
              Bridge did not return a funding delegate address — verify the card_accounts
              response shape against apidocs.bridge.xyz for this program.
            </p>
          )}
        </>
      )}
      {error && <p style={err}>{error}</p>}
    </section>
  );
}

function SubscribeStep({ onDone }: { onDone: () => void }) {
  return (
    <section style={card}>
      <h2>Subscribe on claude.ai</h2>
      <ol style={{ lineHeight: 1.7 }}>
        <li>Open <a href="https://claude.ai/upgrade" target="_blank" rel="noreferrer">claude.ai/upgrade</a> and sign in to <em>your</em> account.</li>
        <li>Pick your plan and enter your new virtual card at checkout (use your verified name and address).</li>
        <li>The charge pulls USDC from your wallet at that moment — nothing is prepaid.</li>
      </ol>
      <button style={cta} onClick={onDone}>I’m subscribed ✓</button>
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
