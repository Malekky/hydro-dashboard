'use client';

import { useEffect, useState } from 'react';
import { formatUnits, type Hex } from 'viem';
import { useAccount, useConnect, useWriteContract } from 'wagmi';
import { publicClient, USDC_DECIMALS } from '@/lib/chain/usdc';
import { ESCROW_STATE, GIFT_ESCROW_ABI, INTENT_OPENED_EVENT, RANK_PLAN, escrowAddress } from '@/lib/solver/escrow';
import { faceUsdc, type GiftMonths } from '@/lib/solver/intent';
import { captureGiftPurchase, reclaimConfigured } from '@/lib/solver/reclaim';
import type { ClaudePlan } from '@/lib/types';
import { Alert, Button, Skeleton } from '@/components/ui';

interface OpenIntentRow {
  id: Hex;
  user: `0x${string}`;
  plan: ClaudePlan;
  months: GiftMonths;
  lockedUsd: number;
  faceUsd: number;
  expiry: number;
}

export default function SolverPage() {
  const escrow = escrowAddress();
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const [rows, setRows] = useState<OpenIntentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!escrow) return;
    let alive = true;

    async function scan() {
      try {
        const latest = await publicClient.getBlockNumber();
        const fromBlock = latest > 500_000n ? latest - 500_000n : 0n;
        const logs = await publicClient.getLogs({
          address: escrow!,
          event: INTENT_OPENED_EVENT,
          fromBlock,
          toBlock: 'latest',
        });
        const candidates = logs.map((log) => {
          const a = (log as unknown as { args: {
            id: Hex; user: `0x${string}`; planRank: number; months: number; lockedUsdc: bigint; expiry: bigint;
          } }).args;
          const plan = RANK_PLAN[a.planRank] as ClaudePlan;
          const months = a.months as GiftMonths;
          return {
            id: a.id, user: a.user, plan, months,
            lockedUsd: Number(formatUnits(a.lockedUsdc, USDC_DECIMALS)),
            faceUsd: Number(faceUsdc(plan, months)) / 10 ** USDC_DECIMALS,
            expiry: Number(a.expiry),
          };
        });
        // Keep only those still Open on-chain (not yet fulfilled/refunded/expired).
        const now = Date.now() / 1000;
        const open: OpenIntentRow[] = [];
        for (const c of candidates) {
          if (c.expiry < now) continue;
          const it = await publicClient.readContract({
            address: escrow!, abi: GIFT_ESCROW_ABI, functionName: 'intents', args: [c.id],
          });
          if (ESCROW_STATE[Number(it[7])] === 'open') open.push(c);
        }
        if (alive) setRows(open);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    }

    scan();
    const t = setInterval(scan, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [escrow]);

  if (!escrow) {
    return (
      <main>
        <PageHead />
        <section className="card">
          <Alert kind="warn">
            Set <code>NEXT_PUBLIC_GIFT_ESCROW_ADDRESS</code> (deploy{' '}
            <code>contracts/GiftIntentEscrow.sol</code> on Base) to load the order book.
          </Alert>
        </section>
      </main>
    );
  }

  return (
    <main>
      <PageHead />
      {!isConnected && (
        <section className="card">
          <p>Connect your solver wallet to claim and fulfill orders.</p>
          <Button onClick={() => connectors[0] && connect({ connector: connectors[0] })}>Connect wallet</Button>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>Open orders</h2>
          <span className="badge badge-neutral">refreshes every 15s</span>
        </div>
        {rows === null ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <Skeleton height="3rem" /><Skeleton height="3rem" />
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">No open orders right now. New orders appear here as users lock USDC.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Plan</th><th>Term</th><th className="num">Face</th><th className="num">You earn</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.plan === 'pro' ? 'Pro' : r.plan === 'max5x' ? 'Max 5x' : 'Max 20x'}</td>
                  <td>{r.months}mo</td>
                  <td className="num">${r.faceUsd.toFixed(0)}</td>
                  <td className="num" style={{ color: 'var(--brand-strong)' }}>+${(r.lockedUsd - r.faceUsd).toFixed(2)}</td>
                  <td><FulfillButton escrow={escrow} row={r} disabled={!isConnected} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && <Alert kind="err">{error}</Alert>}
      </section>
    </main>
  );
}

function FulfillButton({ escrow, row, disabled }: { escrow: `0x${string}`; row: OpenIntentRow; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const { writeContractAsync, isPending } = useWriteContract();

  return (
    <>
      <Button size="sm" variant="secondary" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        Fulfill
      </Button>
      {open && (
        <div style={{ position: 'absolute', marginTop: '0.4rem', background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 'var(--r-md)', padding: '0.9rem', maxWidth: 320, boxShadow: 'var(--shadow-2)', zIndex: 5 }}>
          <ol style={{ paddingLeft: '1.1rem', fontSize: '0.85rem', lineHeight: 1.6, margin: '0 0 0.6rem' }}>
            <li>The user’s email is decrypted to you once you claim.</li>
            <li>Buy this gift at <a href="https://claude.ai/gift" target="_blank" rel="noreferrer">claude.ai/gift</a> for that email.</li>
            <li>Capture the purchase proof (Reclaim) from your claude.ai order page.</li>
            <li>Submit — escrow pays you ${row.lockedUsd.toFixed(2)}.</li>
          </ol>
          <Button
            size="sm"
            loading={isPending || capturing}
            onClick={async () => {
              setError(null);
              try {
                setCapturing(true);
                // Decrypt the intent's recipient email to the solver (off-chain channel,
                // post-claim). Placeholder until the matching layer is wired: prompt.
                const email = window.prompt('Recipient email for this order (from the order details):')?.trim();
                if (!email) { setCapturing(false); return; }
                const { onchainProof } = await captureGiftPurchase({
                  intentId: row.id, escrow, expectedEmail: email,
                });
                setCapturing(false);
                await writeContractAsync({
                  address: escrow, abi: GIFT_ESCROW_ABI, functionName: 'fulfill', args: [row.id, onchainProof],
                });
              } catch (e) {
                setCapturing(false);
                setError(e instanceof Error ? e.message.split('\n')[0] : String(e));
              }
            }}
          >
            {capturing ? 'Capturing proof…' : isPending ? 'Submitting' : 'Capture proof & fulfill'}
          </Button>
          {error && <p style={{ color: 'var(--err-fg)', fontSize: '0.78rem', marginTop: '0.4rem' }}>{error}</p>}
          {!reclaimConfigured() && (
            <p className="hint" style={{ marginTop: '0.4rem' }}>
              Reclaim capture activates once the claude.ai provider is built and{' '}
              <code>NEXT_PUBLIC_RECLAIM_*</code> are set (docs/04 §build order).
            </p>
          )}
        </div>
      )}
    </>
  );
}

function PageHead() {
  return (
    <div style={{ padding: '1.6rem 0 0.25rem' }}>
      <h1>Solver console</h1>
      <p style={{ color: 'var(--ink-2)' }}>
        Claim an order, gift the sub on your own account, prove the purchase, get paid the
        locked USDC. You carry no chargeback risk — you pay Anthropic directly.
      </p>
    </div>
  );
}
