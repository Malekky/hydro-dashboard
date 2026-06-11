import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { countryFromRequest, gateCountry } from '@/lib/compliance/geo';
import {
  BridgeNotConfiguredError,
  createCardAccount,
  getCardAccount,
} from '@/lib/legs/bridgeCard';

const Body = z.object({
  customerId: z.string().min(1),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export async function POST(req: NextRequest) {
  const ipCountry = countryFromRequest(req.headers);
  if (ipCountry) {
    const gate = gateCountry(ipCountry);
    if (!gate.allowed) return NextResponse.json({ blocked: gate }, { status: 451 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const card = await createCardAccount({
      customerId: parsed.data.customerId,
      walletAddress: parsed.data.walletAddress as `0x${string}`,
      idempotencyKey: `card:${parsed.data.customerId}`,
    });
    return NextResponse.json(card);
  } catch (e) {
    if (e instanceof BridgeNotConfiguredError) {
      return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const customerId = req.nextUrl.searchParams.get('customerId');
  const cardAccountId = req.nextUrl.searchParams.get('cardAccountId');
  if (!customerId || !cardAccountId) {
    return NextResponse.json({ error: 'customerId and cardAccountId required' }, { status: 400 });
  }
  try {
    return NextResponse.json(await getCardAccount(customerId, cardAccountId));
  } catch (e) {
    if (e instanceof BridgeNotConfiguredError) {
      return NextResponse.json({ error: 'bridge_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
