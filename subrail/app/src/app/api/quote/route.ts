import { NextRequest, NextResponse } from 'next/server';
import { countryFromRequest, gateCountry } from '@/lib/compliance/geo';
import { routeRails } from '@/lib/rails/router';
import { RailQuoteRequest } from '@/lib/types';

export async function POST(req: NextRequest) {
  const parsed = RailQuoteRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Gate on IP country (authoritative), not the declared routing country.
  const ipCountry = countryFromRequest(req.headers);
  if (ipCountry) {
    const gate = gateCountry(ipCountry);
    if (!gate.allowed) {
      return NextResponse.json({ blocked: gate }, { status: 451 });
    }
  }

  return NextResponse.json({ plans: routeRails(parsed.data) });
}
