import { MAX_RENEWAL_ATTEMPTS, USER_ACTION_TIMEOUT_DAYS, type RenewalJob } from '../types';

/**
 * Pure renewal-job state machine (docs/03-spec.md §3). The cron tick loads due jobs, calls
 * `decide`, and the impure layer executes the returned effect. Keeping decisions pure makes
 * the renewal engine exhaustively unit-testable.
 */

export type RenewalEffect =
  | { kind: 'none' }
  | { kind: 'check_balance' }
  | { kind: 'execute_leg' }
  | { kind: 'nudge_topup' }
  | { kind: 'remind_user_action' }
  | { kind: 'mark_failed'; reason: string };

export interface TickContext {
  now: Date;
  walletBalanceUsd: number;
  requiredUsd: number;
  /** When the job entered awaiting_user_action, if it has. */
  awaitingSince?: Date;
}

const DAY_MS = 86_400_000;

export function decide(job: RenewalJob, ctx: TickContext): { next: RenewalJob; effect: RenewalEffect } {
  switch (job.state) {
    case 'scheduled': {
      if (ctx.now < job.dueAt) return { next: job, effect: { kind: 'none' } };
      if (ctx.walletBalanceUsd < ctx.requiredUsd) {
        return { next: { ...job, state: 'awaiting_funds' }, effect: { kind: 'nudge_topup' } };
      }
      return {
        next: { ...job, state: 'executing', attempts: job.attempts + 1 },
        effect: { kind: 'execute_leg' },
      };
    }
    case 'awaiting_funds': {
      if (ctx.walletBalanceUsd < ctx.requiredUsd) return { next: job, effect: { kind: 'nudge_topup' } };
      return {
        next: { ...job, state: 'executing', attempts: job.attempts + 1 },
        effect: { kind: 'execute_leg' },
      };
    }
    case 'executing': {
      // Re-entered by the tick only if the previous execution attempt errored out.
      if (job.attempts >= MAX_RENEWAL_ATTEMPTS) {
        return {
          next: { ...job, state: 'failed', lastError: job.lastError ?? 'max attempts exceeded' },
          effect: { kind: 'mark_failed', reason: job.lastError ?? 'max attempts exceeded' },
        };
      }
      return { next: { ...job, attempts: job.attempts + 1 }, effect: { kind: 'execute_leg' } };
    }
    case 'awaiting_user_action': {
      const since = ctx.awaitingSince ?? job.dueAt;
      const elapsedDays = (ctx.now.getTime() - since.getTime()) / DAY_MS;
      if (elapsedDays >= USER_ACTION_TIMEOUT_DAYS) {
        return {
          next: { ...job, state: 'failed', lastError: 'user action timeout' },
          effect: { kind: 'mark_failed', reason: 'user action timeout' },
        };
      }
      return { next: job, effect: { kind: 'remind_user_action' } };
    }
    case 'confirmed':
    case 'failed':
    case 'cancelled':
      return { next: job, effect: { kind: 'none' } };
  }
}

/**
 * Next renewal due date for a gift-code subscription: expiry boundary minus 24h, never
 * earlier. Early redemption cancels the running period (anthropics/claude-code#41499) —
 * this function is the single place that rule lives.
 */
export function nextGiftRenewalDueAt(currentPeriodEndsAt: Date): Date {
  return new Date(currentPeriodEndsAt.getTime() - DAY_MS);
}
