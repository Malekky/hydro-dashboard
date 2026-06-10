import { GIFT_FACE_USD, type ClaudePlan, type RenewalJob } from '../types';
import type { LastLeg } from './types';

/**
 * Leg B — official Claude gift subscription codes (docs/03-spec.md §4.4).
 *
 * LAUNCH-GATED: FEATURE_LEG_B stays false until the MSB/CASP legal memo clears and Anthropic
 * outreach has been attempted (docs/02-design.md D5). The operator entity is the merchant of
 * record on this leg only.
 *
 * Hard rules encoded here and in the scheduler:
 *  - Months ∈ {3, 6, 12}; never 1-month codes.
 *  - Next purchase due only at current period expiry − 24h; never auto-redeem. Early
 *    redemption cancels the running period (anthropics/claude-code#41499).
 *  - One code per named recipient, user-initiated — never inventory resale.
 */
export class ClaudeGiftLeg implements LastLeg {
  kind = 'claude_gift_code' as const;

  constructor(private readonly opts: { plan: ClaudePlan; months: 3 | 6 | 12; recipientEmail: string; enabled: boolean }) {}

  requiredUsd(): number {
    return GIFT_FACE_USD[this.opts.plan][this.opts.months];
  }

  async execute(job: RenewalJob, input: { idempotencyKey: string }): Promise<RenewalJob['artifact']> {
    if (!this.opts.enabled) throw new Error('Leg B is feature-flagged off (legal gate, docs/02-design.md D5)');
    // TODO(M2):
    //  1. Pull GIFT_FACE_USD (+0) from user wallet → operator segregated merchant account.
    //  2. Operator purchase at claude.ai/gift for opts.recipientEmail (manual/assisted at
    //     first; automation only with Anthropic's blessing).
    //  3. Deliver code; job → awaiting_user_action; user redeems at claude.ai/gift/redeem.
    void job; void input;
    throw new Error('not implemented: M2, behind FEATURE_LEG_B');
  }
}
