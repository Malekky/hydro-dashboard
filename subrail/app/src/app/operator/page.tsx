'use client';

import { useCallback, useEffect, useState } from 'react';
import { AddressChip, Alert, Button, Skeleton } from '@/components/ui';
import type { GnosisPayCard, GnosisPayTransaction } from '@/lib/gateway/gnosisPay';
import type { Charge } from '@/lib/gateway/ledger';

const FRIEND_LABELS_KEY = 'subrail.cardFriends';
const MAX_ACTIVE_CARDS = 5;

/**
 * Operator console — the server authenticates to Gnosis Pay as the operator (SIWE → JWT).
 * No webhooks on the permissionless tier, so data refreshes by polling.
 */
export default function OperatorPage() {
  const [status, setStatus] = useState<{ configured: boolean; safeAddress?: string } | null>(null);
  const [cards, setCards] = useState<GnosisPayCard[] | null>(null);
  const [txs, setTxs] = useState<{ transactions: GnosisPayTransaction[]; claudeCharges: Charge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      setLabels(JSON.parse(localStorage.getItem(FRIEND_LABELS_KEY) ?? '{}'));
    } catch {
      setLabels({});
    }
  }, []);

  const setLabel = (cardId: string, friend: string) => {
    setLabels((cur) => {
      const next = { ...cur, [cardId]: friend };
      localStorage.setItem(FRIEND_LABELS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const load = useCallback(async () => {
    setError(null);
    const s = await fetch('/api/gateway/status').then((r) => r.json());
    setStatus(s);
    if (!s.configured) return;
    const [c, t] = await Promise.all([
      fetch('/api/gateway/cards').then((r) => r.json()),
      fetch('/api/gateway/transactions').then((r) => r.json()),
    ]);
    if (c.error || t.error) {
      setError(String(c.error ?? t.error));
      return;
    }
    setCards(c.cards);
    setTxs(t);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
    const interval = setInterval(() => load().catch(() => undefined), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  if (status && !status.configured) {
    return (
      <main>
        <PageHead />
        <section className="card">
          <h2>Connect your Gnosis Pay account</h2>
          <p style={{ color: 'var(--ink-2)' }}>
            Two environment variables and you’re live — no partnership, no API key, no
            approval process (Gnosis Pay’s permissionless tier).
          </p>
          <ol style={{ lineHeight: 1.8, paddingLeft: '1.2rem', fontSize: '0.92rem' }}>
            <li>
              <code>GNOSIS_OPERATOR_PRIVATE_KEY</code> — an owner key of your account. It only
              signs sign-in messages; it can’t move funds.
            </li>
            <li>
              <code>GNOSIS_SAFE_ADDRESS</code> — your Gnosis Pay Safe, where friends’
              contributions arrive.
            </li>
          </ol>
          <p className="hint">Restart the app after setting them.</p>
        </section>
      </main>
    );
  }

  const activeCards = cards?.filter((c) => c.statusCode === 1000) ?? cards ?? [];

  return (
    <main>
      <PageHead />

      {status?.safeAddress && (
        <section className="card">
          <div className="card-head">
            <h2 style={{ margin: 0 }}>Gateway Safe</h2>
            <span className="badge badge-ok">Connected</span>
          </div>
          <p className="hint" style={{ marginBottom: '0.5rem' }}>
            Friends’ contributions land here as EURe on Gnosis Chain — instantly, with no
            holding step. Avoid withdrawals near billing dates: cards pause for ~3 minutes
            during withdrawal processing.
          </p>
          <AddressChip value={status.safeAddress} />
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>Cards</h2>
          <Button
            size="sm"
            loading={creating}
            disabled={(cards?.length ?? 0) >= MAX_ACTIVE_CARDS}
            title={`Gnosis Pay allows ${MAX_ACTIVE_CARDS} active cards per account`}
            onClick={async () => {
              setCreating(true);
              try {
                const res = await fetch('/api/gateway/cards', { method: 'POST' });
                if (!res.ok) throw new Error((await res.json()).error);
                await load();
              } catch (e) {
                setError(String(e));
              } finally {
                setCreating(false);
              }
            }}
          >
            New virtual card
          </Button>
        </div>

        {!cards ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <Skeleton height="2.4rem" />
            <Skeleton height="2.4rem" />
          </div>
        ) : cards.length === 0 ? (
          <div className="empty">
            No cards yet. Create one per friend, then add it to their claude.ai account —
            reveal the card number in your Gnosis Pay app.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Status</th>
                <th>Friend</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>•••• {c.lastFourDigits ?? '— — — —'}</td>
                  <td>
                    {c.statusCode === 1000
                      ? <span className="badge badge-ok">Active</span>
                      : <span className="badge badge-neutral">{c.statusCode ?? '—'}</span>}
                  </td>
                  <td>
                    <input
                      className="input"
                      style={{ maxWidth: '11rem', padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
                      placeholder="Assign a friend"
                      value={labels[c.id] ?? ''}
                      onChange={(e) => setLabel(c.id, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="hint" style={{ marginTop: '0.6rem' }}>
          {activeCards.length}/{MAX_ACTIVE_CARDS} active cards used. One card per friend keeps
          charges cleanly attributed.
        </p>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 style={{ margin: 0 }}>Claude charges</h2>
          <span className="badge badge-neutral">refreshes every 30s</span>
        </div>
        {!txs ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <Skeleton height="2rem" />
            <Skeleton height="2rem" />
            <Skeleton height="2rem" />
          </div>
        ) : txs.claudeCharges.length === 0 ? (
          <div className="empty">
            No Anthropic charges yet. Once a card is on a friend’s claude.ai account, their
            monthly charge shows up here automatically.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Merchant</th>
                <th>Friend</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {txs.claudeCharges.map((ch, i) => (
                <tr key={i}>
                  <td>{new Date(ch.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
                  <td>{ch.merchant}</td>
                  <td>{(ch.cardToken && labels[ch.cardToken]) || <span className="hint">—</span>}</td>
                  <td className="num">${ch.usd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {txs && (
          <p className="hint" style={{ marginTop: '0.6rem' }}>
            {txs.transactions.length} total card transaction{txs.transactions.length === 1 ? '' : 's'} in
            the recent window.
          </p>
        )}
      </section>

      {error && <Alert kind="err">{error}</Alert>}
    </main>
  );
}

function PageHead() {
  return (
    <div style={{ padding: '1.6rem 0 0.25rem' }}>
      <h1>Operator console</h1>
      <p style={{ color: 'var(--ink-2)' }}>
        Your gateway at a glance: the Safe your friends fund, the cards that pay their
        subscriptions, and every Claude charge as it lands.
      </p>
    </div>
  );
}
