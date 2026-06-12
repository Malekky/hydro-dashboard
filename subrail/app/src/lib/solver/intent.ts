import { keccak256, toHex, type Hex } from 'viem';
import { GIFT_FACE_USD, type ClaudePlan } from '../types';

/**
 * Solver-market intent model (docs/04-solver-market.md). The user locks USDC + a payload;
 * a solver fulfills by gifting the sub and proving the purchase from their own claude.ai
 * session. The proof must BIND to the intent — these pure functions encode that binding so
 * it can be checked identically off-chain (preflight) and on-chain (the escrow verifier).
 */

export type GiftMonths = 3 | 6 | 12;

export interface GiftIntent {
  id: string;
  /** committed on-chain; raw email is encrypted to the matched solver, never on-chain. */
  recipientEmailHash: Hex;
  plan: ClaudePlan;
  months: GiftMonths;
  /** USDC (6dp) the user locked = face + agreed solver spread. */
  lockedUsdc: bigint;
  /** unix seconds; user can refund after this if unfulfilled. */
  expiry: number;
  openedAt: number;
  state: 'open' | 'claimed' | 'fulfilled' | 'refunded' | 'expired';
  /** solver address once claimed. */
  solver?: `0x${string}`;
}

/** What a solver's purchase proof must reveal (selective disclosure; code stays hidden). */
export interface GiftPurchaseAttestation {
  recipientEmailHash: Hex;
  plan: ClaudePlan;
  months: GiftMonths;
  /** claude.ai order id — the nullifier; each real purchase unlocks ≤1 escrow. */
  orderId: string;
  /** unix seconds the order was placed (per the attested claude.ai data). */
  purchasedAt: number;
}

export const USDC_DECIMALS = 6;

export function hashEmail(email: string): Hex {
  return keccak256(toHex(email.trim().toLowerCase()));
}

export function orderNullifier(orderId: string): Hex {
  return keccak256(toHex(`claude-gift:${orderId}`));
}

/** Face price (USDC, 6dp) for a plan/duration. */
export function faceUsdc(plan: ClaudePlan, months: GiftMonths): bigint {
  return BigInt(GIFT_FACE_USD[plan][months]) * 10n ** BigInt(USDC_DECIMALS);
}

const PLAN_RANK: Record<ClaudePlan, number> = { pro: 0, max5x: 1, max20x: 2 };

export type BindFailure =
  | 'email_mismatch'
  | 'plan_insufficient'
  | 'months_insufficient'
  | 'stale_purchase'
  | 'intent_not_claimable';

/**
 * Does this attestation satisfy the intent? Mirrors the on-chain `fulfill` checks
 * (docs/04-solver-market.md "What the proof must bind"). Returns null on success, else the
 * specific failure — so the solver console can preflight before paying gas.
 */
export function checkBinding(
  intent: Pick<GiftIntent, 'recipientEmailHash' | 'plan' | 'months' | 'openedAt' | 'state'>,
  att: GiftPurchaseAttestation,
): BindFailure | null {
  if (intent.state !== 'open' && intent.state !== 'claimed') return 'intent_not_claimable';
  if (att.recipientEmailHash.toLowerCase() !== intent.recipientEmailHash.toLowerCase()) return 'email_mismatch';
  if (PLAN_RANK[att.plan] < PLAN_RANK[intent.plan]) return 'plan_insufficient';
  if (att.months < intent.months) return 'months_insufficient';
  // Freshness: the gift must have been bought after the intent opened (no replaying an old
  // personal gift). Small backdating tolerance for clock skew between claude.ai and chain.
  if (att.purchasedAt < intent.openedAt - 600) return 'stale_purchase';
  return null;
}

/** Minimum USDC a user must lock = face × (1 + spread). */
export function requiredLock(plan: ClaudePlan, months: GiftMonths, spreadBps: number): bigint {
  return (faceUsdc(plan, months) * BigInt(10_000 + spreadBps)) / 10_000n;
}
