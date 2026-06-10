import type { RenewalJob } from '../types';

/**
 * A "last leg" turns USDC into progress toward a paid claude.ai subscription
 * (docs/02-design.md D2). Implementations must be idempotent per job attempt.
 */
export interface LastLeg {
  kind: RenewalJob['leg'];
  /** USD the wallet must hold for this cycle (face + leg fee; excludes Subrail fee). */
  requiredUsd(input: { faceUsd: number }): number;
  /**
   * Execute one renewal cycle. Returns the artifact the user must act on (gift/redeem code)
   * or null when no user action is needed (e.g. card recurring).
   */
  execute(job: RenewalJob, input: { idempotencyKey: string }): Promise<RenewalJob['artifact'] | null>;
}
