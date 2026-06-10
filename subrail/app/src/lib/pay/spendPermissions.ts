/**
 * Coinbase Spend Permissions integration — docs/03-spec.md §4.2.
 *
 * The renewal service holds a dedicated spender key that can ONLY execute pulls the user
 * granted: monthly USDC cap, allow-listed recipients (merchant deposit addresses + the
 * Subrail fee address), on-chain revocable. User principal moves wallet → merchant directly;
 * it never transits Subrail (compliance constraint C2, docs/02-design.md).
 */

export interface SpendPermissionGrant {
  wallet: `0x${string}`;
  spender: `0x${string}`;
  token: `0x${string}`; // USDC on Base
  periodDays: 30;
  capUsd: number;
  allowedRecipients: `0x${string}`[];
  signature: `0x${string}`;
  revokedAt?: Date;
}

export interface SpendPermissionRail {
  /** Build the grant payload for the user's smart wallet to sign (client side). */
  prepareGrant(input: { wallet: `0x${string}`; capUsd: number; recipients: `0x${string}`[] }): Promise<unknown>;
  /** Execute a permitted pull: transfer `usd` of USDC from the user's wallet to `to`. */
  pull(grant: SpendPermissionGrant, input: { to: `0x${string}`; usd: number; idempotencyKey: string }): Promise<{ tx: `0x${string}` }>;
  /** Relay an on-chain revocation (also doable wallet-side without us). */
  revoke(grant: SpendPermissionGrant): Promise<{ tx: `0x${string}` }>;
}

export class StubSpendPermissionRail implements SpendPermissionRail {
  async prepareGrant(input: { wallet: `0x${string}`; capUsd: number; recipients: `0x${string}`[] }) {
    // TODO(M2): Coinbase Smart Wallet SDK spend-permission typed data (viem).
    return { todo: 'spend-permission typed data', ...input };
  }
  async pull(): Promise<{ tx: `0x${string}` }> {
    throw new Error('not implemented: M2 (FEATURE_AUTONOMOUS_RENEWALS)');
  }
  async revoke(): Promise<{ tx: `0x${string}` }> {
    throw new Error('not implemented: M2');
  }
}
