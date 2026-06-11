'use client';

import { useEffect, useState } from 'react';
import type { GnosisPayCard, GnosisPayTransaction } from '@/lib/gateway/gnosisPay';
import type { Charge } from '@/lib/gateway/ledger';

/**
 * Operator console — authenticated server-side as the operator (SIWE → JWT).
 * Permissionless tier has no webhooks, so this polls the transactions endpoint.
 */
export default function OperatorPage() {
  const [status, setStatus] = useState<{ configured: boolean; safeAddress?: string } | null>(null);
  const [cards, setCards] = useState<GnosisPayCard[] | null>(null);
  const [txs, setTxs] = useState<{ transactions: GnosisPayTransaction[]; claudeCharges: Charge[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    setError(null);
    const s = await fetch('/api/gateway/status').then((r) => r.json());
    setStatus(s);
    if (!s.configured) return;
    const [c, t] = await Promise.all([
      fetch('/api/gateway/cards').then((r) => r.json()),
      fetch('/api/gateway/transactions').then((r) => r.json()),
    ]);
    if (c.error || t.error) {
      setError(c.error ?? t.error);
      return;
    }
    setCards(c.cards);
    setTxs(t);
  }

  useEffect(() => {
    load().catch((e) => setError(String(e)));
    const interval = setInterval(() => load().catch(() => undefined), 30_000);
    return () => clearInterval(interval);
  }, []);

  if (status && !status.configured) {
    return (
      <main>
        <h1>Operator console</h1>
        <section style={{ ...card, borderColor: '#b58900' }}>
          <p>
            Set <code>GNOSIS_OPERATOR_PRIVATE_KEY</code> (an owner key of your Gnosis Pay
            account — used only to sign SIWE logins) and <code>GNOSIS_SAFE_ADDRESS</code>,
            then restart. No partnership or API key required.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main>
      <h1>Operator console</h1>
      {status?.safeAddress && (
        <p style={{ fontSize: '0.9rem' }}>
          Gateway Safe (Gnosis Chain): <code>{status.safeAddress}</code> — friends’
          contributions land here as EURe.
        </p>
      )}

      <section style={card}>
        <h2 style={{ display: 'flex', justifyContent: 'space-between' }}>
          Cards
          <button
            style={cta}
            disabled={creating || (cards?.length ?? 0) >= 5}
            title="Max 5 active cards per Gnosis Pay account"
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
            {creating ? 'Creating…' : '+ Virtual card'}
          </button>
        </h2>
        {!cards ? <p>Loading…</p> : cards.length === 0 ? <p>No cards yet.</p> : (
          <ul>
            {cards.map((c) => (
              <li key={c.id}>
                {c.virtual !== false ? 'Virtual' : 'Physical'} •••• {c.lastFourDigits ?? '????'}
                {c.statusCode === 1000 ? ' (active)' : ''}
                <span style={{ color: '#666', fontSize: '0.8rem' }}> — assign to a friend; reveal PAN in the Gnosis Pay app</span>
              </li>
            ))}
          </ul>
        )}
        <p style={{ fontSize: '0.8rem', color: '#666' }}>
          One card per friend keeps attribution clean (account cap: 5 active cards).
        </p>
      </section>

      <section style={card}>
        <h2>Claude charges</h2>
        {!txs ? <p>Loading…</p> : txs.claudeCharges.length === 0 ? (
          <p>No Anthropic charges detected yet.</p>
        ) : (
          <table style={{ width: '100%', fontSize: '0.9rem' }}>
            <thead><tr><th align="left">When</th><th align="left">Merchant</th><th align="right">USD</th></tr></thead>
            <tbody>
              {txs.claudeCharges.map((ch, i) => (
                <tr key={i}>
                  <td>{new Date(ch.at).toLocaleString()}</td>
                  <td>{ch.merchant}</td>
                  <td align="right">${ch.usd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: '0.8rem', color: '#666' }}>
          Polled every 30s (webhooks are partner-gated). All transactions: {txs?.transactions.length ?? '—'}.
        </p>
      </section>

      {error && <p style={{ color: '#8a1f11' }}>{error}</p>}
    </main>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #ddd', borderRadius: 8, padding: '1rem', marginBlock: '1rem', background: '#fff',
};
const cta: React.CSSProperties = {
  background: '#2f6f4f', color: '#fff', border: 'none', borderRadius: 6,
  padding: '0.4rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem',
};
