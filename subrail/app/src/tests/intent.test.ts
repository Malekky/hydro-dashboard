import { describe, expect, it } from 'vitest';
import {
  checkBinding, faceUsdc, hashEmail, orderNullifier, requiredLock,
  type GiftIntent, type GiftPurchaseAttestation,
} from '../lib/solver/intent';

const OPENED = 1_750_000_000;
const intent: Pick<GiftIntent, 'recipientEmailHash' | 'plan' | 'months' | 'openedAt' | 'state'> = {
  recipientEmailHash: hashEmail('friend@example.com'),
  plan: 'pro',
  months: 3,
  openedAt: OPENED,
  state: 'open',
};

const goodAtt: GiftPurchaseAttestation = {
  recipientEmailHash: hashEmail('friend@example.com'),
  plan: 'pro',
  months: 3,
  orderId: 'cs_test_abc123',
  purchasedAt: OPENED + 120,
};

describe('solver intent binding', () => {
  it('accepts a faithful purchase', () => {
    expect(checkBinding(intent, goodAtt)).toBeNull();
  });

  it('rejects a gift sent to a different email', () => {
    expect(checkBinding(intent, { ...goodAtt, recipientEmailHash: hashEmail('someone@else.com') }))
      .toBe('email_mismatch');
  });

  it('normalizes email case/whitespace before hashing', () => {
    expect(checkBinding(intent, { ...goodAtt, recipientEmailHash: hashEmail('  Friend@Example.com ') }))
      .toBeNull();
  });

  it('rejects a cheaper plan than ordered', () => {
    const maxIntent = { ...intent, plan: 'max5x' as const };
    expect(checkBinding(maxIntent, goodAtt)).toBe('plan_insufficient');
  });

  it('accepts a more generous plan than ordered', () => {
    expect(checkBinding(intent, { ...goodAtt, plan: 'max20x' })).toBeNull();
  });

  it('rejects fewer months than ordered', () => {
    const sixMo = { ...intent, months: 6 as const };
    expect(checkBinding(sixMo, goodAtt)).toBe('months_insufficient');
  });

  it('rejects a gift bought before the intent opened (replay)', () => {
    expect(checkBinding(intent, { ...goodAtt, purchasedAt: OPENED - 5_000 })).toBe('stale_purchase');
  });

  it('tolerates small clock skew on freshness', () => {
    expect(checkBinding(intent, { ...goodAtt, purchasedAt: OPENED - 300 })).toBeNull();
  });

  it('rejects fulfilling an already-settled intent', () => {
    expect(checkBinding({ ...intent, state: 'fulfilled' }, goodAtt)).toBe('intent_not_claimable');
  });
});

describe('solver intent economics', () => {
  it('prices face in USDC 6dp', () => {
    expect(faceUsdc('pro', 3)).toBe(60_000_000n);
    expect(faceUsdc('max20x', 12)).toBe(2_400_000_000n);
  });

  it('adds the spread to the required lock', () => {
    expect(requiredLock('pro', 3, 500)).toBe(63_000_000n); // $60 + 5%
  });

  it('derives a stable nullifier per order id', () => {
    expect(orderNullifier('cs_test_abc123')).toBe(orderNullifier('cs_test_abc123'));
    expect(orderNullifier('cs_test_abc123')).not.toBe(orderNullifier('cs_test_xyz'));
  });
});
