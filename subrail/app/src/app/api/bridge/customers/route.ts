import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { countryFromRequest, gateCountry } from '@/lib/compliance/geo';
import {
  BridgeNotConfiguredError,
  bridgeConfigured,
  createCustomerWithKyc,
  getCustomerKycStatus,
} from '@/lib/legs/bridgeCard';

const Body = z.object({ fullName: z.string().min(2), email: z.string().email() });

export async function POST(req: NextRequest) {
  const ipCountry = countryFromRequest(req.headers);
  if (ipCountry) {
    const gate = gateCountry(ipCountry);
    if (!gate.allowed) return NextResponse.json({ blocked: gate }, { status: 451 });
  }
  if (!bridgeConfigured()) {
    return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const kyc = await createCustomerWithKyc({
      ...parsed.data,
      idempotencyKey: `cust:${parsed.data.email}`,
    });
    return NextResponse.json(kyc);
  } catch (e) {
    if (e instanceof BridgeNotConfiguredError) {
      return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const customerId = req.nextUrl.searchParams.get('customerId');
  if (!customerId) return NextResponse.json({ error: 'customerId required' }, { status: 400 });
  try {
    return NextResponse.json({ status: await getCustomerKycStatus(customerId) });
  } catch (e) {
    if (e instanceof BridgeNotConfiguredError) {
      return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
