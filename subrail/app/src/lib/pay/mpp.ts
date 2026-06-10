/**
 * Tempo Machine Payments Protocol adapter — PHASE 2 (docs/02-design.md D1).
 *
 * MPP is open (CC0 specs at github.com/tempoxyz/mpp-specs; `mppx` on npm; mpp-rs) and has
 * the better native subscription primitive (access keys with auto-resetting periodic caps;
 * MPP Sessions = pre-authorized limit + off-chain vouchers). Not used in v1 because Peer
 * settles USDC natively on Base and bridging $20 payments to Tempo (USDC.e) adds cost and
 * risk. This interface keeps the swap cheap if/when the calculus changes — e.g. Stripe
 * fronting Anthropic with stablecoin billing.
 */

export interface PaymentRail {
  name: 'x402-base' | 'mpp-tempo';
  /** Authorize a recurring cap for the renewal agent. */
  authorize(input: { wallet: string; capUsd: number; periodDays: number }): Promise<unknown>;
  /** Pay an exact amount to a recipient under the standing authorization. */
  pay(input: { to: string; usd: number; idempotencyKey: string }): Promise<{ ref: string }>;
}

export class MppTempoRail implements PaymentRail {
  name = 'mpp-tempo' as const;
  async authorize(): Promise<unknown> {
    throw new Error('phase 2: implement with mppx (session intents / access keys)');
  }
  async pay(): Promise<{ ref: string }> {
    throw new Error('phase 2');
  }
}
