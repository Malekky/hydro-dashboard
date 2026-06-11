import { describe, expect, it } from 'vitest';
import { decide, nextGiftRenewalDueAt } from '../lib/renewal/scheduler';
import type { RenewalJob } from '../lib/types';

const base: RenewalJob = {
  id: 'j1',
  subscriptionId: 's1',
  leg: 'appstore_giftcard',
  dueAt: new Date('2026-07-01T00:00:00Z'),
  state: 'scheduled',
  attempts: 0,
};

const ctx = (over: Partial<Parameters<typeof decide>[1]> = {}) => ({
  now: new Date('2026-07-01T01:00:00Z'),
  walletBalanceUsd: 100,
  requiredUsd: 22,
  ...over,
});

describe('renewal scheduler', () => {
  it('does nothing before dueAt', () => {
    const { next, effect } = decide(base, ctx({ now: new Date('2026-06-30T00:00:00Z') }));
    expect(effect.kind).toBe('none');
    expect(next.state).toBe('scheduled');
  });

  it('nudges top-up when balance is short', () => {
    const { next, effect } = decide(base, ctx({ walletBalanceUsd: 5 }));
    expect(effect.kind).toBe('nudge_topup');
    expect(next.state).toBe('awaiting_funds');
  });

  it('executes when due and funded, incrementing attempts', () => {
    const { next, effect } = decide(base, ctx());
    expect(effect.kind).toBe('execute_leg');
    expect(next.state).toBe('executing');
    expect(next.attempts).toBe(1);
  });

  it('recovers from awaiting_funds once funded', () => {
    const { next } = decide({ ...base, state: 'awaiting_funds' }, ctx());
    expect(next.state).toBe('executing');
  });

  it('fails after max attempts', () => {
    const { next, effect } = decide({ ...base, state: 'executing', attempts: 3, lastError: 'boom' }, ctx());
    expect(next.state).toBe('failed');
    expect(effect).toEqual({ kind: 'mark_failed', reason: 'boom', reimburseUsd: undefined });
  });

  it('reimburses pulled-but-undelivered USDC to the user wallet on failure', () => {
    const { effect } = decide(
      { ...base, state: 'executing', attempts: 3, lastError: 'leg failed', pulledUsd: 22 },
      ctx(),
    );
    expect(effect).toEqual({ kind: 'mark_failed', reason: 'leg failed', reimburseUsd: 22 });
  });

  it('does not reimburse when the artifact was already delivered', () => {
    const { effect } = decide(
      {
        ...base,
        state: 'awaiting_user_action',
        pulledUsd: 22,
        artifact: { kind: 'gift_code', deliveredTo: 'user@example.com' },
      },
      ctx({ awaitingSince: new Date('2026-06-20T00:00:00Z') }),
    );
    expect(effect).toEqual({ kind: 'mark_failed', reason: 'user action timeout', reimburseUsd: undefined });
  });

  it('reminds, then times out, awaiting user action', () => {
    const awaiting: RenewalJob = { ...base, state: 'awaiting_user_action' };
    const early = decide(awaiting, ctx({ awaitingSince: new Date('2026-06-30T00:00:00Z') }));
    expect(early.effect.kind).toBe('remind_user_action');

    const late = decide(awaiting, ctx({ awaitingSince: new Date('2026-06-20T00:00:00Z') }));
    expect(late.next.state).toBe('failed');
    expect(late.next.lastError).toBe('user action timeout');
  });

  it('terminal states are inert', () => {
    for (const state of ['confirmed', 'failed', 'cancelled'] as const) {
      expect(decide({ ...base, state }, ctx()).effect.kind).toBe('none');
    }
  });

  it('schedules gift renewals at expiry boundary minus 24h, never earlier', () => {
    const expires = new Date('2026-10-01T00:00:00Z');
    expect(nextGiftRenewalDueAt(expires).toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });
});
