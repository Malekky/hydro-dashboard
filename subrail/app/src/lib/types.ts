import { z } from 'zod';

/** ISO 3166-1 alpha-2, uppercase. */
export type Country = string;

export const ClaudePlan = z.enum(['pro', 'max5x', 'max20x']);
export type ClaudePlan = z.infer<typeof ClaudePlan>;

/** Monthly face price in USD per plan (verified 2026-06, docs/01-research.md §1). */
export const PLAN_FACE_USD: Record<ClaudePlan, number> = {
  pro: 20,
  max5x: 100,
  max20x: 200,
};

/** Gift-code face price by plan and duration (months) — claude.ai/gift, Dec 2025 pricing. */
export const GIFT_FACE_USD: Record<ClaudePlan, Record<3 | 6 | 12, number>> = {
  pro: { 3: 60, 6: 120, 12: 216 },
  max5x: { 3: 300, 6: 600, 12: 1200 },
  max20x: { 3: 600, 6: 1200, 12: 2400 },
};

export const PeerPlatform = z.enum([
  'venmo', 'cashapp', 'zelle', 'paypal', 'revolut', 'wise', 'monzo', 'n26',
  'mercado_pago', 'alipay', 'chime', 'luxon',
]);
export type PeerPlatform = z.infer<typeof PeerPlatform>;

export const LegKind = z.enum(['appstore_giftcard', 'claude_gift_code', 'gateway_card']);
export type LegKind = z.infer<typeof LegKind>;

export const OnrampMode = z.enum(['peer_desktop_ext', 'peer_app_handoff', 'external_deposit']);
export type OnrampMode = z.infer<typeof OnrampMode>;

export const DisclosureId = z.enum([
  'wise_p2p_tos',        // Wise AUP prohibits P2P crypto flows incl. buyer side
  'revolut_p2p_tos',     // Revolut crypto terms prohibit third-party transactions
  'venmo_commercial_tos',
  'peer_no_recourse',    // Peer cannot reverse/mediate fiat disputes
  'circle_freeze',       // USDC is freezable by the issuer
  'not_affiliated',      // Subrail is not affiliated with Anthropic
  'gateway_operator',    // contributions fund the operator's personal Gnosis Pay Safe
]);
export type DisclosureId = z.infer<typeof DisclosureId>;

export const RailQuoteRequest = z.object({
  country: z.string().length(2).transform((s) => s.toUpperCase()),
  plan: ClaudePlan,
  platforms: z.array(PeerPlatform).default([]),
  device: z.enum(['mobile', 'desktop']).default('mobile'),
});
export type RailQuoteRequest = z.infer<typeof RailQuoteRequest>;

export type Cadence =
  | { kind: 'apple_topup'; period: 'monthly' }
  /** Gift codes are never 1 month: redemption stacking is unsupported and has destroyed
   *  value in the wild (anthropics/claude-code#41499). Renew at expiry boundary only. */
  | { kind: 'gift_code'; months: 3 | 6 | 12 }
  | { kind: 'card_recurring' };

export interface RailCosts {
  faceUsd: number;
  onrampSpreadBps: number;
  legFeeBps: number;
  subrailFeeUsd: number;
  estTotalMonthlyUsd: number;
}

export type BlockedReason = 'sanctions' | 'anthropic_unsupported' | 'no_viable_leg';

export interface RailPlan {
  id: string;
  leg: LegKind;
  onramp: OnrampMode;
  peerPlatform?: PeerPlatform;
  cadence: Cadence;
  costs: RailCosts;
  disclosures: DisclosureId[];
  /** Present iff the request cannot be served; all other fields are placeholders then. */
  blocked?: { reason: BlockedReason };
}

export type FundingIntentState =
  | 'created' | 'awaiting_fiat' | 'attested' | 'settled' | 'expired' | 'failed';

export interface FundingIntent {
  id: string;
  wallet: `0x${string}`;
  mode: OnrampMode;
  quotedUsd: number;
  state: FundingIntentState;
  peerIntentHash?: `0x${string}`;
  settledTx?: `0x${string}`;
  createdAt: Date;
}

export type RenewalState =
  | 'scheduled' | 'awaiting_funds' | 'executing' | 'awaiting_user_action'
  | 'confirmed' | 'failed' | 'cancelled';

export interface RenewalJob {
  id: string;
  subscriptionId: string;
  leg: LegKind;
  dueAt: Date;
  state: RenewalState;
  attempts: number;
  lastError?: string;
  /** USDC pulled from the user's wallet for this cycle but not yet delivered as value.
   *  On failure this amount is reimbursed to the same wallet the user onramped into. */
  pulledUsd?: number;
  reimbursedTx?: `0x${string}`;
  artifact?: { kind: 'gift_code' | 'apple_code'; deliveredTo: string };
}

export const MAX_RENEWAL_ATTEMPTS = 3;
/** User has this long to complete `awaiting_user_action` before the job fails. */
export const USER_ACTION_TIMEOUT_DAYS = 7;
