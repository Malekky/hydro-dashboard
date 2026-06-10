/**
 * Minimal x402 helpers (exact scheme, USDC on Base) — docs/03-spec.md §4.5.
 * Used for Subrail's own service fee: /api/fee responds 402 with payment requirements; the
 * client retries with a signed EIP-3009 payload; the facilitator verifies + settles.
 * Spec: github.com/x402-foundation/x402 (v2 headers: PAYMENT-REQUIRED / PAYMENT-SIGNATURE /
 * PAYMENT-RESPONSE, Base64-encoded JSON).
 */

export interface X402Requirements {
  scheme: 'exact';
  network: string;          // CAIP-2, e.g. 'eip155:8453'
  asset: `0x${string}`;     // USDC on Base
  payTo: `0x${string}`;
  maxAmountRequired: string; // atomic units
  description: string;
}

export function feeRequirements(input: { payTo: `0x${string}`; usd: number }): X402Requirements {
  return {
    scheme: 'exact',
    network: 'eip155:8453',
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC (Base)
    payTo: input.payTo,
    maxAmountRequired: BigInt(Math.round(input.usd * 1e6)).toString(),
    description: 'Subrail monthly service fee',
  };
}

export function encodeRequirementsHeader(req: X402Requirements): string {
  return Buffer.from(JSON.stringify({ x402Version: 2, accepts: [req] })).toString('base64');
}

export async function settleWithFacilitator(paymentSignatureHeader: string): Promise<{ ok: boolean; tx?: string }> {
  // TODO(M1): POST to X402_FACILITATOR_URL /verify then /settle (CDP facilitator).
  void paymentSignatureHeader;
  throw new Error('not implemented: wire CDP facilitator');
}
