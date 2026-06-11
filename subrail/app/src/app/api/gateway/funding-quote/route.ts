import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { countryFromRequest, gateCountry } from '@/lib/compliance/geo';
import { getFundingQuote } from '@/lib/gateway/funding';
import { gatewayConfigured, gatewaySafeAddress } from '@/lib/gateway/gnosisPay';

const Body = z.object({
  friendWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  usd: z.number().min(1).max(2500),
});

/** Quote the Base-USDC → Gnosis-EURe route delivering straight to the operator's Safe. */
export async function POST(req: NextRequest) {
  const ipCountry = countryFromRequest(req.headers);
  if (ipCountry) {
    const gate = gateCountry(ipCountry);
    if (!gate.allowed) return NextResponse.json({ blocked: gate }, { status: 451 });
  }
  if (!gatewayConfigured()) {
    return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const quote = await getFundingQuote({
      friendWallet: parsed.data.friendWallet as `0x${string}`,
      safeAddress: gatewaySafeAddress(),
      usd: parsed.data.usd,
    });
    return NextResponse.json(quote);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
