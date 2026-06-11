/**
 * Friend ledger — pure functions reconciling friend contributions against claude.ai
 * charges on the operator's Gnosis Pay card(s). No webhooks on the permissionless tier,
 * so charges come from polling GET /api/v1/cards/transactions.
 */

import type { GnosisPayTransaction } from './gnosisPay';

export interface Contribution {
  friend: string;
  usd: number;
  at: Date;
  txHash?: string;
}

export interface Charge {
  usd: number;
  at: Date;
  merchant: string;
  cardToken?: string;
}

/** Does a card transaction look like an Anthropic/claude.ai subscription charge? */
export function isClaudeCharge(tx: GnosisPayTransaction): boolean {
  const name = (tx.merchant?.name ?? '').toUpperCase();
  return name.includes('ANTHROPIC') || name.includes('CLAUDE');
}

export function toCharge(tx: GnosisPayTransaction): Charge | null {
  if (!isClaudeCharge(tx)) return null;
  const usd = Number(tx.billingAmount ?? tx.transactionAmount ?? NaN);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  return {
    usd,
    at: new Date(tx.clearedAt ?? tx.createdAt ?? Date.now()),
    merchant: tx.merchant?.name ?? 'unknown',
    cardToken: tx.cardToken,
  };
}

export interface FriendStanding {
  friend: string;
  contributedUsd: number;
  consumedUsd: number;
  balanceUsd: number;
  /** Whole months of runway left at the plan's face price. */
  monthsRemaining: number;
}

/**
 * Standing per friend. Charges are attributed via cardToken when a card↔friend mapping
 * exists (≤5 cards account cap); unmapped charges are split across friends pro-rata to
 * contributions — adequate for a private friends circle, revisit if it ever grows.
 */
export function computeStandings(input: {
  contributions: Contribution[];
  charges: Charge[];
  faceUsdByFriend: Record<string, number>;
  cardTokenToFriend?: Record<string, string>;
}): FriendStanding[] {
  const friends = [...new Set(input.contributions.map((c) => c.friend))];
  const contributed = new Map<string, number>(friends.map((f) => [f, 0]));
  for (const c of input.contributions) {
    contributed.set(c.friend, (contributed.get(c.friend) ?? 0) + c.usd);
  }

  const consumed = new Map<string, number>(friends.map((f) => [f, 0]));
  let unattributed = 0;
  for (const ch of input.charges) {
    const friend = ch.cardToken ? input.cardTokenToFriend?.[ch.cardToken] : undefined;
    if (friend && consumed.has(friend)) {
      consumed.set(friend, (consumed.get(friend) ?? 0) + ch.usd);
    } else {
      unattributed += ch.usd;
    }
  }
  const totalContributed = [...contributed.values()].reduce((a, b) => a + b, 0);
  if (unattributed > 0 && totalContributed > 0) {
    for (const f of friends) {
      const share = (contributed.get(f) ?? 0) / totalContributed;
      consumed.set(f, (consumed.get(f) ?? 0) + unattributed * share);
    }
  }

  return friends.map((friend) => {
    const contributedUsd = contributed.get(friend) ?? 0;
    const consumedUsd = consumed.get(friend) ?? 0;
    const balanceUsd = contributedUsd - consumedUsd;
    const face = input.faceUsdByFriend[friend] ?? 20;
    return {
      friend,
      contributedUsd: round2(contributedUsd),
      consumedUsd: round2(consumedUsd),
      balanceUsd: round2(balanceUsd),
      monthsRemaining: Math.max(0, Math.floor(balanceUsd / face)),
    };
  });
}

const round2 = (n: number) => Math.round(n * 100) / 100;
