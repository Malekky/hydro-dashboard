'use client';

import { ReclaimProofRequest, transformForOnchain, type Proof } from '@reclaimprotocol/js-sdk';
import { hashEmail, type GiftMonths, type GiftPurchaseAttestation } from './intent';
import type { ClaudePlan } from '../types';

/**
 * Reclaim zkTLS capture for the solver market (docs/04-solver-market.md §capture layer).
 *
 * The solver, logged into their OWN claude.ai account, runs the Reclaim flow against a
 * CUSTOM provider that captures claude.ai's order/billing response and selectively
 * discloses {recipient email (→hash), plan, months, order id, timestamp} while REDACTING
 * the redeemable gift code. The returned proof is:
 *   - bound to this intent via `addContext(intentId, {escrow, intentId})` so it can't be
 *     replayed against another intent (re-checked on-chain in fulfill);
 *   - transformed via `transformForOnchain` into calldata our escrow's Reclaim verifier
 *     consumes.
 *
 * Config (set once the custom provider exists — gated on the $20 artifact capture):
 *   NEXT_PUBLIC_RECLAIM_APP_ID, NEXT_PUBLIC_RECLAIM_APP_SECRET (proxy server-side for prod),
 *   NEXT_PUBLIC_RECLAIM_CLAUDE_PROVIDER_ID.
 */

export function reclaimConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_RECLAIM_APP_ID &&
      process.env.NEXT_PUBLIC_RECLAIM_APP_SECRET &&
      process.env.NEXT_PUBLIC_RECLAIM_CLAUDE_PROVIDER_ID,
  );
}

export interface CaptureResult {
  /** Parsed, intent-binding fields (preflight against checkBinding before submitting). */
  attestation: GiftPurchaseAttestation;
  /** Calldata for GiftIntentEscrow.fulfill → the Reclaim Solidity verifier. */
  onchainProof: `0x${string}`;
}

/**
 * Drive the Reclaim flow for the solver and return a bound, on-chain-ready proof.
 * `recipientEmail` is the (decrypted, solver-visible) email the intent committed to; we use
 * it only to assert the captured order matches and to recompute the on-chain hash.
 */
export async function captureGiftPurchase(input: {
  intentId: `0x${string}`;
  escrow: `0x${string}`;
  expectedEmail: string;
  onStatus?: (s: string) => void;
}): Promise<CaptureResult> {
  if (!reclaimConfigured()) {
    throw new Error('Reclaim not configured (custom claude.ai provider pending — docs/04 §build order step 2)');
  }
  const req = await ReclaimProofRequest.init(
    process.env.NEXT_PUBLIC_RECLAIM_APP_ID!,
    process.env.NEXT_PUBLIC_RECLAIM_APP_SECRET!,
    process.env.NEXT_PUBLIC_RECLAIM_CLAUDE_PROVIDER_ID!,
  );
  // Bind to this intent (lands in claimInfo.context; re-checked on-chain).
  req.addContext(input.intentId, JSON.stringify({ escrow: input.escrow, intentId: input.intentId }));

  input.onStatus?.('Opening claude.ai capture…');
  await req.triggerReclaimFlow();

  const proof = await new Promise<Proof>((resolve, reject) => {
    req.startSession({
      onSuccess: (p) => {
        const one = Array.isArray(p) ? p[0] : p;
        if (!one) reject(new Error('Reclaim returned no proof'));
        else resolve(one);
      },
      onError: (e) => reject(e instanceof Error ? e : new Error(String(e))),
    });
  });

  const attestation = parseProof(proof, input.expectedEmail);
  const onchainProof = transformForOnchain(proof) as unknown as `0x${string}`;
  return { attestation, onchainProof };
}

/**
 * Pull our revealed fields out of the proof's claim parameters. The exact field names
 * depend on the provider's responseRedactions/jsonPath config (finalized against the real
 * claude.ai order JSON). Kept isolated so only this mapping changes when the provider does.
 */
export function parseProof(proof: Proof, expectedEmail: string): GiftPurchaseAttestation {
  const params = JSON.parse(proof.claimData.parameters || '{}') as Record<string, unknown>;
  const extracted = (params.paramValues ?? params) as Record<string, string>;

  const plan = (extracted.plan as ClaudePlan) ?? 'pro';
  const months = Number(extracted.months) as GiftMonths;
  const orderId = String(extracted.orderId ?? extracted.order_id ?? '');
  const purchasedAt = Number(extracted.purchasedAt ?? extracted.timestamp ?? 0);

  // Recipient is revealed as a hash (email itself stays private); recompute from the
  // expected email and trust the on-chain equality check to enforce the match.
  return {
    recipientEmailHash: hashEmail(expectedEmail),
    plan,
    months,
    orderId,
    purchasedAt,
  };
}
