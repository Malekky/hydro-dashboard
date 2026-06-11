import { describe, expect, it } from 'vitest';
import { routeRails } from '../lib/rails/router';

describe('rails router', () => {
  it('blocks OFAC-comprehensive countries', () => {
    const plans = routeRails({ country: 'IR', plan: 'pro', platforms: [], device: 'mobile' });
    expect(plans).toHaveLength(1);
    expect(plans[0].blocked?.reason).toBe('sanctions');
  });

  it('blocks Anthropic-unsupported countries', () => {
    const plans = routeRails({ country: 'RU', plan: 'pro', platforms: [], device: 'mobile' });
    expect(plans[0].blocked?.reason).toBe('anthropic_unsupported');
  });

  it('ranks the USDC→Stripe card leg first where an issuer covers the country (US)', () => {
    const plans = routeRails({ country: 'US', plan: 'pro', platforms: ['cashapp'], device: 'mobile' });
    expect(plans[0].leg).toBe('virtual_card');
    expect(plans[0].cadence).toEqual({ kind: 'card_recurring' });
  });

  it('serves Nigeria via the card leg (Kulipa) with gift code as fallback', () => {
    const plans = routeRails({ country: 'NG', plan: 'pro', platforms: [], device: 'mobile' });
    expect(plans.map((p) => p.leg)).toEqual(['virtual_card', 'claude_gift_code']);
  });

  it('serves Argentina via the card leg (Bridge) over Peer/Mercado Pago', () => {
    const plans = routeRails({ country: 'AR', plan: 'pro', platforms: ['mercado_pago'], device: 'mobile' });
    expect(plans[0].leg).toBe('virtual_card');
    expect(plans[0].peerPlatform).toBe('mercado_pago');
    expect(plans[0].onramp).toBe('peer_app_handoff');
  });

  it('falls back to the app-store leg where no card issuer covers the country (Brazil)', () => {
    const plans = routeRails({ country: 'BR', plan: 'pro', platforms: ['mercado_pago'], device: 'mobile' });
    expect(plans[0].leg).toBe('appstore_giftcard');
  });

  it('uses external deposit when the user has no reachable Peer platform (Nigeria)', () => {
    const plans = routeRails({ country: 'NG', plan: 'pro', platforms: [], device: 'mobile' });
    expect(plans[0].onramp).toBe('external_deposit'); // onramp leg = how stables are acquired
  });

  it('never quotes 1-month gift codes (stacking hazard)', () => {
    for (const country of ['NG', 'AR', 'US', 'IN']) {
      for (const plan of routeRails({ country, plan: 'pro', platforms: [], device: 'mobile' })) {
        if (plan.cadence.kind === 'gift_code') {
          expect([3, 6, 12]).toContain(plan.cadence.months);
        }
      }
    }
  });

  it('uses the desktop extension flow on desktop with a usable platform', () => {
    const plans = routeRails({ country: 'US', plan: 'max5x', platforms: ['venmo'], device: 'desktop' });
    expect(plans[0].onramp).toBe('peer_desktop_ext');
  });

  it('attaches platform-specific ToS disclosures (Wise)', () => {
    const plans = routeRails({ country: 'GB', plan: 'pro', platforms: ['wise'], device: 'mobile' });
    expect(plans[0].disclosures).toContain('wise_p2p_tos');
  });

  it('itemizes costs and totals plausibly for Pro', () => {
    const [plan] = routeRails({ country: 'US', plan: 'pro', platforms: ['cashapp'], device: 'mobile' });
    expect(plan.costs.faceUsd).toBe(20);
    expect(plan.costs.estTotalMonthlyUsd).toBeGreaterThan(20);
    expect(plan.costs.estTotalMonthlyUsd).toBeLessThan(25);
  });
});
