import type { RenewalJob } from '../types';
import type { LastLeg } from './types';

/**
 * PRIMARY LEG — USDC → Stripe directly: a user-named JIT (just-in-time) funded Visa debit
 * card via Bridge (Stripe Issuing), non-custodial funding mode (docs/02-design.md D2;
 * research: docs/01-research.md §4.5).
 *
 * Mechanics (verified against docs.stripe.com/issuing/bridge-stablecoin-cards and
 * apidocs.bridge.xyz/platform/cards):
 *  - One-time setup: Bridge KYC for the cardholder → virtual Visa card in the USER's name;
 *    the user's wallet grants an amount-bounded ERC-20 approval (USDC) to the
 *    developer-scoped Bridge delegate address. The user enters the card at claude.ai
 *    checkout once; Stripe Billing stores it as ordinary card-on-file.
 *  - Each cycle: the renewal agent raises the allowance to cycle amount × buffer shortly
 *    before Anthropic's billing date; Bridge pulls USDC from the user's wallet AT
 *    AUTHORIZATION (no prepaid float); after settlement the agent drops the allowance back
 *    toward zero. Card balance/allowance ≈ $0 between cycles — minimal fraud surface.
 *  - Failure: if the merchant-initiated auth declines (allowance/balance gap, chain
 *    congestion, agent downtime), Stripe Smart Retries re-attempt over days — the agent
 *    must hold the allowance open across the retry window, alert the user, and only then
 *    fall back to the app-store / gift-code legs. No reimbursement is ever needed on this
 *    leg: funds move only at successful authorization.
 *
 * Open items (M0 spikes): Bridge program approval (KYB); whether Base is an enumerated
 * chain for Bridge's card contract (Solana confirmed; "EVM where deployed" — verify);
 * measured MIT decline behavior on a live Claude subscription (no public data exists).
 */
export class BridgeJitCardLeg implements LastLeg {
  kind = 'virtual_card' as const;

  constructor(
    private readonly opts: {
      bridgeApiKey: string;
      cardId: string;
      /** Allowance buffer over face to absorb FX/fee jitter at auth time. */
      bufferBps?: number;
    },
  ) {}

  requiredUsd({ faceUsd }: { faceUsd: number }): number {
    const buffer = this.opts.bufferBps ?? 300;
    return Math.round(faceUsd * (1 + buffer / 10_000) * 100) / 100;
  }

  async execute(job: RenewalJob, input: { idempotencyKey: string }): Promise<RenewalJob['artifact'] | null> {
    // TODO(M1):
    //  1. Read next billing date from subscription record (user-entered; later inferred
    //     from auth webhooks).
    //  2. Set the user's wallet allowance to requiredUsd (wallet-side tx the user
    //     pre-authorized via spend permission, or session-key execution).
    //  3. Arm the Bridge/Stripe Issuing auth webhook; job → confirmed on settled auth.
    //  4. After settlement + retry window, lower allowance; on terminal decline, surface
    //     fallback leg selection to the user.
    void job; void input;
    throw new Error('not implemented: wire Bridge card program (M1)');
  }
}
