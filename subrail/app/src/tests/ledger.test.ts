import { describe, expect, it } from 'vitest';
import { computeStandings, isClaudeCharge, toCharge } from '../lib/gateway/ledger';

const tx = (merchant: string, billingAmount: string, cardToken?: string) => ({
  merchant: { name: merchant },
  billingAmount,
  cardToken,
  clearedAt: '2026-06-01T00:00:00Z',
});

describe('gateway ledger', () => {
  it('detects Anthropic/Claude charges case-insensitively', () => {
    expect(isClaudeCharge(tx('ANTHROPIC', '20'))).toBe(true);
    expect(isClaudeCharge(tx('Claude.ai subscription', '20'))).toBe(true);
    expect(isClaudeCharge(tx('NETFLIX.COM', '15'))).toBe(false);
  });

  it('converts transactions to charges and rejects junk amounts', () => {
    expect(toCharge(tx('ANTHROPIC', '20.00'))?.usd).toBe(20);
    expect(toCharge(tx('ANTHROPIC', 'not-a-number'))).toBeNull();
    expect(toCharge(tx('SPOTIFY', '9.99'))).toBeNull();
  });

  it('attributes charges via the card↔friend mapping', () => {
    const standings = computeStandings({
      contributions: [
        { friend: 'amal', usd: 63, at: new Date() },
        { friend: 'bola', usd: 21, at: new Date() },
      ],
      charges: [
        { usd: 20, at: new Date(), merchant: 'ANTHROPIC', cardToken: 'card-a' },
        { usd: 20, at: new Date(), merchant: 'ANTHROPIC', cardToken: 'card-a' },
      ],
      faceUsdByFriend: { amal: 20, bola: 20 },
      cardTokenToFriend: { 'card-a': 'amal' },
    });
    const amal = standings.find((s) => s.friend === 'amal')!;
    const bola = standings.find((s) => s.friend === 'bola')!;
    expect(amal.consumedUsd).toBe(40);
    expect(amal.monthsRemaining).toBe(1); // 63 - 40 = 23 → 1 month at $20
    expect(bola.consumedUsd).toBe(0);
    expect(bola.monthsRemaining).toBe(1);
  });

  it('splits unattributed charges pro-rata to contributions', () => {
    const standings = computeStandings({
      contributions: [
        { friend: 'amal', usd: 75, at: new Date() },
        { friend: 'bola', usd: 25, at: new Date() },
      ],
      charges: [{ usd: 40, at: new Date(), merchant: 'CLAUDE.AI' }],
      faceUsdByFriend: { amal: 20, bola: 20 },
    });
    expect(standings.find((s) => s.friend === 'amal')!.consumedUsd).toBe(30);
    expect(standings.find((s) => s.friend === 'bola')!.consumedUsd).toBe(10);
  });
});
