'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button } from '@/components/ui';
import type { PeerPlatform, RailPlan } from '@/lib/types';

const PLANS = [
  { id: 'pro', name: 'Pro', price: 20, blurb: 'Everyday Claude' },
  { id: 'max5x', name: 'Max 5x', price: 100, blurb: 'Heavy use' },
  { id: 'max20x', name: 'Max 20x', price: 200, blurb: 'All-day workhorse' },
] as const;

const COUNTRIES: [string, string][] = [
  ['AR', 'Argentina'], ['AU', 'Australia'], ['AT', 'Austria'], ['BD', 'Bangladesh'],
  ['BE', 'Belgium'], ['BR', 'Brazil'], ['CA', 'Canada'], ['CL', 'Chile'],
  ['CO', 'Colombia'], ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EC', 'Ecuador'],
  ['EG', 'Egypt'], ['FI', 'Finland'], ['FR', 'France'], ['DE', 'Germany'],
  ['GH', 'Ghana'], ['GR', 'Greece'], ['IN', 'India'], ['ID', 'Indonesia'],
  ['IE', 'Ireland'], ['IT', 'Italy'], ['JP', 'Japan'], ['KE', 'Kenya'],
  ['MX', 'Mexico'], ['NL', 'Netherlands'], ['NZ', 'New Zealand'], ['NG', 'Nigeria'],
  ['NO', 'Norway'], ['PK', 'Pakistan'], ['PE', 'Peru'], ['PH', 'Philippines'],
  ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['ZA', 'South Africa'],
  ['ES', 'Spain'], ['SE', 'Sweden'], ['CH', 'Switzerland'], ['TR', 'Türkiye'],
  ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom'], ['US', 'United States'],
  ['UY', 'Uruguay'], ['VN', 'Vietnam'],
];

const PLATFORM_LABELS: Record<PeerPlatform, string> = {
  venmo: 'Venmo', cashapp: 'Cash App', zelle: 'Zelle', paypal: 'PayPal',
  revolut: 'Revolut', wise: 'Wise', monzo: 'Monzo', n26: 'N26',
  mercado_pago: 'Mercado Pago', alipay: 'Alipay', chime: 'Chime', luxon: 'Luxon',
};

const LEG_COPY: Record<RailPlan['leg'], { title: string; detail: string }> = {
  gateway_card: {
    title: 'Gateway card',
    detail: 'Your USDC funds the gateway; its card pays claude.ai for you every month.',
  },
  appstore_giftcard: {
    title: 'App-store route',
    detail: 'USDC buys an Apple gift card; your Claude subscription renews from Apple balance.',
  },
  claude_gift_code: {
    title: 'Official gift code',
    detail: 'USDC buys an official Claude gift subscription you redeem on your account.',
  },
};

export default function Landing() {
  const [country, setCountry] = useState('US');
  const [plan, setPlan] = useState<(typeof PLANS)[number]['id']>('pro');
  const [platforms, setPlatforms] = useState<PeerPlatform[]>([]);
  const [quotes, setQuotes] = useState<RailPlan[] | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function getQuote() {
    setLoading(true);
    setBlocked(null);
    setQuotes(null);
    try {
      const device = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 ? 'mobile' : 'desktop';
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ country, plan, platforms, device }),
      });
      if (res.status === 451) {
        setBlocked((await res.json()).blocked?.reason ?? 'unavailable');
        return;
      }
      const body = await res.json();
      const plans: RailPlan[] = body.plans ?? [];
      if (plans[0]?.blocked) setBlocked(plans[0].blocked.reason);
      else setQuotes(plans);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section style={{ padding: '2.2rem 0 0.5rem' }}>
        <h1>Keep your Claude subscription paid — no international card needed.</h1>
        <p style={{ color: 'var(--ink-2)', maxWidth: '46ch' }}>
          Pay with the money apps you already use. Subrail turns it into USDC in your own
          wallet and keeps claude.ai paid through your gateway.
        </p>
      </section>

      <section className="card" aria-label="Plan your route">
        <label className="field">
          <span>Where are you?</span>
          <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>

        <div className="field">
          <span>Claude plan</span>
          <div className="radio-cards" role="radiogroup" aria-label="Claude plan">
            {PLANS.map((p) => (
              <label key={p.id} className="radio-card" data-checked={plan === p.id}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <input
                    type="radio"
                    name="plan"
                    checked={plan === p.id}
                    onChange={() => setPlan(p.id)}
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <span style={{ color: 'var(--muted)', marginLeft: '0.5rem', fontSize: '0.85rem' }}>{p.blurb}</span>
                  </span>
                </span>
                <span className="price">${p.price}/mo</span>
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Money apps you already use <small>(optional — improves your route)</small></span>
          <div className="chips">
            {(Object.keys(PLATFORM_LABELS) as PeerPlatform[]).map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                aria-pressed={platforms.includes(p)}
                onClick={() =>
                  setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]))
                }
              >
                {PLATFORM_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        <Button className="btn-block" loading={loading} onClick={getQuote}>
          Show my route
        </Button>
      </section>

      {blocked && (
        <Alert kind="err">
          Subrail isn’t available in this region
          {blocked === 'sanctions' ? ' (sanctioned territory)' : blocked === 'anthropic_unsupported' ? ' (Claude isn’t offered there)' : ''}.
        </Alert>
      )}

      {quotes && (
        <section aria-label="Your routes">
          {quotes.map((q, i) => {
            const copy = LEG_COPY[q.leg];
            const spread = (q.costs.faceUsd * q.costs.onrampSpreadBps) / 10_000;
            const legFee = (q.costs.faceUsd * q.costs.legFeeBps) / 10_000;
            return (
              <article key={q.id} className={`card ${i === 0 ? 'recommended' : ''}`}>
                <div className="card-head">
                  <h2 style={{ margin: 0 }}>{copy.title}</h2>
                  {i === 0 ? <span className="badge badge-brand">Recommended</span> : <span className="badge badge-neutral">Backup</span>}
                </div>
                <p style={{ color: 'var(--ink-2)' }}>{copy.detail}</p>
                <dl className="kv" style={{ margin: '0.25rem 0' }}>
                  <dt>All-in monthly cost</dt>
                  <dd>${q.costs.estTotalMonthlyUsd.toFixed(2)}</dd>
                </dl>
                <details className="fees">
                  <summary>Fee breakdown</summary>
                  <div style={{ paddingTop: '0.4rem' }}>
                    <div className="cost-row"><span>Claude {plan} plan</span><span className="amount">${q.costs.faceUsd.toFixed(2)}</span></div>
                    <div className="cost-row"><span>Getting USDC{q.peerPlatform ? ` via ${PLATFORM_LABELS[q.peerPlatform]}` : ''}</span><span className="amount">${spread.toFixed(2)}</span></div>
                    <div className="cost-row"><span>Payment route</span><span className="amount">${legFee.toFixed(2)}</span></div>
                    <div className="cost-row"><span>Subrail</span><span className="amount">${q.costs.subrailFeeUsd.toFixed(2)}</span></div>
                    <div className="cost-row total"><span>Total / month</span><span className="amount">${q.costs.estTotalMonthlyUsd.toFixed(2)}</span></div>
                  </div>
                </details>
                {i === 0 && (
                  <div style={{ marginTop: '0.9rem' }}>
                    <Link
                      className="btn btn-primary"
                      href={`/onboarding?plan=${plan}&platform=${q.peerPlatform ?? ''}`}
                    >
                      Start with this route
                    </Link>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
