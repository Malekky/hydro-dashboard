import { ANTHROPIC_UNSUPPORTED, OFAC_BLOCKED } from '../rails/coverage';
import type { Country } from '../types';

/**
 * Continuous geo-gate (docs/01-research.md §5: the OFAC Exodus/ShapeShift standard is
 * lifetime-of-the-relationship IP checks, not onboarding-only). Call on every session AND
 * every state-mutating API route.
 */

export type GeoDecision =
  | { allowed: true }
  | { allowed: false; reason: 'sanctions' | 'anthropic_unsupported'; country: Country };

export function gateCountry(country: Country): GeoDecision {
  const c = country.toUpperCase();
  if (OFAC_BLOCKED.has(c)) return { allowed: false, reason: 'sanctions', country: c };
  if (ANTHROPIC_UNSUPPORTED.has(c)) return { allowed: false, reason: 'anthropic_unsupported', country: c };
  return { allowed: true };
}

/**
 * Resolve the request's country from the platform's GeoIP header.
 * Vercel sets `x-vercel-ip-country`; behind other proxies, configure equivalently and
 * never trust a client-supplied value for gating (declared country is for ROUTING only).
 */
export function countryFromRequest(headers: Headers): Country | null {
  const c = headers.get('x-vercel-ip-country') ?? headers.get('cf-ipcountry');
  return c ? c.toUpperCase() : null;
}

/** TODO(M2): VPN/proxy heuristic score → step-up friction (docs/03-spec.md §4.6). */
