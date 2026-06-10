import type { Country, PeerPlatform } from '../types';

/**
 * Country coverage matrix.
 *
 * Provenance: docs/01-research.md (research synthesis, 2026-06-10). Every list here is
 * INDICATIVE and carries an expiry: re-verify against the live source before enabling a
 * corridor in production. Lists change quarterly in this market.
 */

/**
 * OFAC comprehensive sanctions programs as of 2026-06 (Cuba, Iran, DPRK; Crimea/DNR/LNR are
 * region-level within UA — modeled here at country granularity for the gate, with RU/BY
 * included because Anthropic does not support them and broad programs apply).
 * Source: ofac.treasury.gov sanctions programs; Syria's comprehensive program was revoked
 * 2025-07-01 but Anthropic still lists SY as unsupported.
 */
export const OFAC_BLOCKED: ReadonlySet<Country> = new Set(['CU', 'IR', 'KP']);

/**
 * Not on Anthropic's supported-countries list (subset relevant to the gate; full list at
 * anthropic.com/supported-countries — re-scrape at build time in production).
 */
export const ANTHROPIC_UNSUPPORTED: ReadonlySet<Country> = new Set([
  'CN', 'HK', 'MO', 'RU', 'BY', 'IR', 'KP', 'SY', 'CU', 'AF', 'CF', 'CD', 'ER',
  'ET', 'LY', 'ML', 'MM', 'NI', 'SO', 'SS', 'SD', 'VE', 'YE',
]);

/**
 * Where each Peer (zkp2p) platform is realistically usable by a buyer.
 * Peer's contracts configure the PLATFORMS (zkp2p-contracts README, 2026-06); the country
 * mapping below is our routing heuristic (e.g. Wise/Revolut multi-currency reach), not a
 * Peer-published list. 'GLOBAL' = available in most non-blocked countries.
 */
export const PEER_PLATFORM_REACH: Record<PeerPlatform, 'US' | 'EU_UK' | 'LATAM' | 'GLOBAL'> = {
  venmo: 'US',
  cashapp: 'US',
  zelle: 'US',
  chime: 'US',
  paypal: 'GLOBAL',
  revolut: 'EU_UK',
  wise: 'GLOBAL',
  monzo: 'EU_UK',
  n26: 'EU_UK',
  mercado_pago: 'LATAM',
  alipay: 'GLOBAL',
  luxon: 'GLOBAL',
};

export const US_COUNTRIES: ReadonlySet<Country> = new Set(['US']);
export const EU_UK_COUNTRIES: ReadonlySet<Country> = new Set([
  'GB', 'IE', 'FR', 'DE', 'ES', 'PT', 'IT', 'NL', 'BE', 'AT', 'PL', 'CZ', 'RO',
  'GR', 'HU', 'SE', 'DK', 'FI', 'NO', 'CH', 'LT', 'LV', 'EE', 'SK', 'SI', 'HR', 'BG',
]);
export const LATAM_COUNTRIES: ReadonlySet<Country> = new Set([
  'AR', 'BR', 'MX', 'CL', 'CO', 'PE', 'UY', 'EC',
]);

/**
 * Countries with a local Apple App Store gift-card product purchasable via crypto gift-card
 * merchants (Bitrefill/Coinsbee catalogs, 2026-06: US, UK, NL, BR, TR, IN confirmed; EU
 * majors widely listed). NOT most of Africa. Re-verify per SKU before enabling.
 */
export const APPLE_GIFTCARD_COUNTRIES: ReadonlySet<Country> = new Set([
  'US', 'GB', 'IE', 'FR', 'DE', 'ES', 'PT', 'IT', 'NL', 'BE', 'AT', 'PL', 'SE',
  'DK', 'FI', 'NO', 'CH', 'CA', 'AU', 'NZ', 'JP', 'BR', 'MX', 'TR', 'IN', 'SA', 'AE',
]);

/**
 * Phase-2 virtual-card issuance coverage (user-named consumer cards).
 * bridge: live 18 countries 2026-03, LatAm-led (AR CO EC MX PE CL US confirmed at launch).
 * kulipa: NG + AR + EU confirmed. None: IN/PK/BD (market-wide gap).
 */
export const CARD_ISSUER_COVERAGE: Record<'bridge' | 'kulipa', ReadonlySet<Country>> = {
  bridge: new Set(['US', 'AR', 'CO', 'EC', 'MX', 'PE', 'CL']),
  kulipa: new Set(['NG', 'AR', 'FR', 'DE', 'ES', 'IT', 'NL', 'BE', 'PT', 'IE', 'AT']),
};

export function peerPlatformsFor(country: Country): PeerPlatform[] {
  const out: PeerPlatform[] = [];
  for (const [platform, reach] of Object.entries(PEER_PLATFORM_REACH) as
    [PeerPlatform, 'US' | 'EU_UK' | 'LATAM' | 'GLOBAL'][]) {
    const ok =
      reach === 'GLOBAL' ||
      (reach === 'US' && US_COUNTRIES.has(country)) ||
      (reach === 'EU_UK' && EU_UK_COUNTRIES.has(country)) ||
      (reach === 'LATAM' && LATAM_COUNTRIES.has(country));
    if (ok) out.push(platform);
  }
  return out;
}
