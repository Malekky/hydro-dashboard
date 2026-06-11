import {
  GIFT_FACE_USD, PLAN_FACE_USD,
  type Cadence, type DisclosureId, type LegKind, type OnrampMode,
  type PeerPlatform, type RailPlan, type RailQuoteRequest,
} from '../types';
import {
  ANTHROPIC_UNSUPPORTED, APPLE_GIFTCARD_COUNTRIES, CARD_ISSUER_COVERAGE, OFAC_BLOCKED,
  peerPlatformsFor,
} from './coverage';

/** Tunable economics (docs/02-design.md D6). */
const PEER_SPREAD_BPS = 100;      // ~1% maker spread, conservative
const CARD_LEG_FEE_BPS = 100;     // JIT card issuer fee placeholder until Bridge pricing verified
const APPLE_LEG_FEE_BPS = 200;    // Bitrefill markup ceiling until verified
const GIFT_LEG_FEE_BPS = 0;       // operator buys at face; costs covered by subrail fee
const SUBRAIL_FEE_USD = 1.5;

/** Primary first: USDC→Stripe direct via JIT card, then app-store, then gift code. */
const LEG_RANK: Record<LegKind, number> = {
  virtual_card: 0,
  appstore_giftcard: 1,
  claude_gift_code: 2,
};

const PLATFORM_DISCLOSURES: Partial<Record<PeerPlatform, DisclosureId>> = {
  wise: 'wise_p2p_tos',
  revolut: 'revolut_p2p_tos',
  venmo: 'venmo_commercial_tos',
};

function blockedPlan(req: RailQuoteRequest, reason: NonNullable<RailPlan['blocked']>['reason']): RailPlan {
  return {
    id: `blocked:${req.country}:${req.plan}`,
    leg: 'appstore_giftcard',
    onramp: 'external_deposit',
    cadence: { kind: 'apple_topup', period: 'monthly' },
    costs: { faceUsd: 0, onrampSpreadBps: 0, legFeeBps: 0, subrailFeeUsd: 0, estTotalMonthlyUsd: 0 },
    disclosures: [],
    blocked: { reason },
  };
}

function costs(faceMonthlyUsd: number, onrampSpreadBps: number, legFeeBps: number) {
  const est = faceMonthlyUsd * (1 + onrampSpreadBps / 10_000 + legFeeBps / 10_000) + SUBRAIL_FEE_USD;
  return {
    faceUsd: faceMonthlyUsd,
    onrampSpreadBps,
    legFeeBps,
    subrailFeeUsd: SUBRAIL_FEE_USD,
    estTotalMonthlyUsd: Math.round(est * 100) / 100,
  };
}

/**
 * The rails router: country × plan × user's platforms × device → ranked viable RailPlans.
 * Pure and deterministic; liquidity-depth checks happen at quote-confirmation time, not here.
 */
export function routeRails(req: RailQuoteRequest): RailPlan[] {
  if (OFAC_BLOCKED.has(req.country)) return [blockedPlan(req, 'sanctions')];
  if (ANTHROPIC_UNSUPPORTED.has(req.country)) return [blockedPlan(req, 'anthropic_unsupported')];

  const reachable = peerPlatformsFor(req.country);
  const usable = req.platforms.filter((p) => reachable.includes(p));
  const preferred: PeerPlatform | undefined = usable[0] ?? undefined;

  const onramp: OnrampMode = preferred
    ? (req.device === 'desktop' ? 'peer_desktop_ext' : 'peer_app_handoff')
    : 'external_deposit'; // no Peer rail → user deposits USDC from elsewhere

  const baseDisclosures: DisclosureId[] = ['peer_no_recourse', 'circle_freeze', 'not_affiliated'];
  const platformDisclosure = preferred ? PLATFORM_DISCLOSURES[preferred] : undefined;
  const disclosures = platformDisclosure ? [...baseDisclosures, platformDisclosure] : baseDisclosures;

  const plans: RailPlan[] = [];

  // PRIMARY — USDC→Stripe direct: user-named JIT card (Bridge via Stripe Issuing, or
  // Kulipa) that pulls USDC from the user's wallet at authorization against an
  // amount-bounded allowance. The merchant's recurring Stripe Billing sees an ordinary
  // Visa debit card-on-file (docs/02-design.md D2).
  const cardIssuer = CARD_ISSUER_COVERAGE.bridge.has(req.country)
    ? 'bridge'
    : CARD_ISSUER_COVERAGE.kulipa.has(req.country)
      ? 'kulipa'
      : null;
  if (cardIssuer) {
    plans.push({
      id: `card:${cardIssuer}:${req.country}:${req.plan}`,
      leg: 'virtual_card' satisfies LegKind,
      onramp,
      peerPlatform: preferred,
      cadence: { kind: 'card_recurring' },
      costs: costs(PLAN_FACE_USD[req.plan], preferred ? PEER_SPREAD_BPS : 0, CARD_LEG_FEE_BPS),
      disclosures,
    });
  }

  // Fallback 1 — app-store balance via crypto gift-card MoR, where Apple gift cards exist.
  if (APPLE_GIFTCARD_COUNTRIES.has(req.country)) {
    const cadence: Cadence = { kind: 'apple_topup', period: 'monthly' };
    plans.push({
      id: `appstore:${req.country}:${req.plan}`,
      leg: 'appstore_giftcard' satisfies LegKind,
      onramp,
      peerPlatform: preferred,
      cadence,
      costs: costs(PLAN_FACE_USD[req.plan], preferred ? PEER_SPREAD_BPS : 0, APPLE_LEG_FEE_BPS),
      disclosures,
    });
  }

  // Fallback 2 — official Claude gift codes. 3-month minimum (stacking hazard);
  // feature-flagged in execution, but always quotable so coverage gaps are visible.
  {
    const months = 3 as const;
    const faceMonthly = GIFT_FACE_USD[req.plan][months] / months;
    plans.push({
      id: `gift:${req.country}:${req.plan}`,
      leg: 'claude_gift_code',
      onramp,
      peerPlatform: preferred,
      cadence: { kind: 'gift_code', months },
      costs: costs(faceMonthly, preferred ? PEER_SPREAD_BPS : 0, GIFT_LEG_FEE_BPS),
      disclosures,
    });
  }

  if (plans.length === 0) return [blockedPlan(req, 'no_viable_leg')];

  // Rank: USDC→Stripe card leg first (docs/02-design.md D2), then by all-in cost.
  return plans.sort((a, b) =>
    LEG_RANK[a.leg] !== LEG_RANK[b.leg]
      ? LEG_RANK[a.leg] - LEG_RANK[b.leg]
      : a.costs.estTotalMonthlyUsd - b.costs.estTotalMonthlyUsd,
  );
}
