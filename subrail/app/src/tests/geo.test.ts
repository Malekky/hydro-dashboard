import { describe, expect, it } from 'vitest';
import { countryFromRequest, gateCountry } from '../lib/compliance/geo';

describe('geo gate', () => {
  it('blocks sanctioned countries', () => {
    expect(gateCountry('IR')).toEqual({ allowed: false, reason: 'sanctions', country: 'IR' });
    expect(gateCountry('kp').allowed).toBe(false); // case-insensitive
  });

  it('blocks Anthropic-unsupported countries with the right reason', () => {
    expect(gateCountry('CN')).toEqual({ allowed: false, reason: 'anthropic_unsupported', country: 'CN' });
  });

  it('allows supported countries', () => {
    for (const c of ['AR', 'NG', 'US', 'IN', 'BR']) {
      expect(gateCountry(c)).toEqual({ allowed: true });
    }
  });

  it('reads platform GeoIP headers only', () => {
    expect(countryFromRequest(new Headers({ 'x-vercel-ip-country': 'br' }))).toBe('BR');
    expect(countryFromRequest(new Headers({ 'cf-ipcountry': 'AR' }))).toBe('AR');
    expect(countryFromRequest(new Headers())).toBeNull();
  });
});
