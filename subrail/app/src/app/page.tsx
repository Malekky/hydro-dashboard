'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { RailPlan } from '@/lib/types';

const PLANS = [
  { id: 'pro', label: 'Pro — $20/mo' },
  { id: 'max5x', label: 'Max 5x — $100/mo' },
  { id: 'max20x', label: 'Max 20x — $200/mo' },
] as const;

const PLATFORMS = [
  'venmo', 'cashapp', 'zelle', 'paypal', 'revolut', 'wise', 'monzo', 'n26',
  'mercado_pago', 'alipay', 'chime', 'luxon',
] as const;

export default function Landing() {
  const [country, setCountry] = useState('US');
  const [plan, setPlan] = useState<'pro' | 'max5x' | 'max20x'>('pro');
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<RailPlan[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function getQuote() {
    setLoading(true);
    setBlocked(null);
    setQuotes(null);
    const res = await fetch('/api/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ country, plan, platforms, device: 'desktop' }),
    });
    setLoading(false);
    if (res.status === 451) {
      const body = await res.json();
      setBlocked(body.blocked?.reason ?? 'unavailable');
      return;
    }
    const body = await res.json();
    const plans: RailPlan[] = body.plans ?? [];
    if (plans[0]?.blocked) {
      setBlocked(plans[0].blocked.reason);
    } else {
      setQuotes(plans);
    }
  }

  return (
    <main>
      <h1>Subrail</h1>
      <p>Subscribe to Claude from anywhere — no international card needed.</p>

      <section style={card}>
        <label style={row}>
          Country (ISO-2)
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
            style={{ width: '4rem', textAlign: 'center' }}
          />
        </label>
        <label style={row}>
          Claude plan
          <select value={plan} onChange={(e) => setPlan(e.target.value as typeof plan)}>
            {PLANS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        <fieldset style={{ border: 'none', padding: 0 }}>
          <legend style={{ fontSize: '0.9rem' }}>Payment apps you already use</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {PLATFORMS.map((p) => (
              <label key={p} style={{ fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={platforms.includes(p)}
                  onChange={(e) =>
                    setPlatforms((cur) => (e.target.checked ? [...cur, p] : cur.filter((x) => x !== p)))
                  }
                />{' '}
                {p.replace('_', ' ')}
              </label>
            ))}
          </div>
        </fieldset>
        <button onClick={getQuote} disabled={loading} style={cta}>
          {loading ? 'Routing…' : 'Show my rail plan'}
        </button>
      </section>

      {blocked && (
        <p style={{ color: '#8a1f11' }}>
          Subrail isn’t available for this region ({blocked.replace('_', ' ')}).
        </p>
      )}

      {quotes?.map((q, i) => (
        <section key={q.id} style={{ ...card, borderColor: i === 0 ? '#2f6f4f' : '#ddd' }}>
          <strong>
            {i === 0 ? 'Recommended: ' : 'Fallback: '}
            {q.leg === 'virtual_card' && 'USDC card → pay claude.ai directly'}
            {q.leg === 'appstore_giftcard' && 'App-store gift card → Claude in-app subscription'}
            {q.leg === 'claude_gift_code' && 'Official Claude gift code'}
          </strong>
          <p style={{ margin: '0.4rem 0' }}>
            ≈ ${q.costs.estTotalMonthlyUsd.toFixed(2)}/mo all-in
            {q.peerPlatform ? ` · fund via ${q.peerPlatform.replace('_', ' ')} on Peer` : ' · fund via USDC deposit'}
          </p>
          {i === 0 && (
            <Link
              href={`/onboarding?country=${country}&plan=${plan}&platform=${q.peerPlatform ?? ''}&leg=${q.leg}`}
              style={{ ...cta, display: 'inline-block', textDecoration: 'none' }}
            >
              Start →
            </Link>
          )}
        </section>
      ))}

      <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '2rem' }}>
        Subrail is not affiliated with Anthropic. Not available in sanctioned or
        Claude-unsupported regions.
      </p>
    </main>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: '1rem',
  marginBlock: '1rem',
  background: '#fff',
};
const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '0.6rem',
};
const cta: React.CSSProperties = {
  background: '#2f6f4f',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '0.55rem 1.1rem',
  cursor: 'pointer',
  fontSize: '0.95rem',
};
