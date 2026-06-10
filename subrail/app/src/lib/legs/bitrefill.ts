import type { RenewalJob } from '../types';
import type { LastLeg } from './types';

/**
 * Leg A — Apple/Google gift card via Bitrefill Business API → app-store balance → Claude IAP
 * (docs/03-spec.md §4.3).
 *
 * Verified (docs/01-research.md §4.3): Bitrefill has a real API ("programmatically purchase
 * gift cards… pay with crypto or balance — BTC, Lightning, ETH, USDC, USDT"), personal tier
 * self-serve, Business tier (full catalog, bulk) via api@bitrefill.com. Apple SKUs are
 * region-locked: SKU country MUST equal the user's Apple ID country. Preferred settlement:
 * the user's wallet pays the invoice's USDC deposit address directly (spend-permission pull),
 * so principal never transits Subrail.
 *
 * Open items before production: Apple SKU availability on our key tier; per-SKU markup;
 * Apple-balance auto-renew pilot per country (M0 gate).
 */
export class BitrefillAppleLeg implements LastLeg {
  kind = 'appstore_giftcard' as const;

  constructor(private readonly opts: { apiKey: string; appleCountry: string; deliverTo: string }) {}

  requiredUsd({ faceUsd }: { faceUsd: number }): number {
    const MARKUP_BPS = 200; // ceiling until verified per SKU
    return Math.round(faceUsd * (1 + MARKUP_BPS / 10_000) * 100) / 100;
  }

  async execute(job: RenewalJob, input: { idempotencyKey: string }): Promise<RenewalJob['artifact']> {
    // TODO(M1):
    //  1. GET catalog → Apple SKU for this.opts.appleCountry (fail loudly if absent).
    //  2. POST /purchase (or create invoice) with idempotencyKey.
    //  3. Trigger spend-permission pull: user wallet → invoice USDC deposit address.
    //  4. Poll until code issued; deliver to this.opts.deliverTo.
    void job; void input;
    throw new Error('not implemented: wire Bitrefill Business API');
  }
}
