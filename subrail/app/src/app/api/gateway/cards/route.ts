import { NextResponse } from 'next/server';
import {
  GatewayNotConfiguredError,
  createVirtualCard,
  listCards,
} from '@/lib/gateway/gnosisPay';

export async function GET() {
  try {
    return NextResponse.json({ cards: await listCards() });
  } catch (e) {
    return gatewayError(e);
  }
}

/** Operator action: one virtual card per friend (free, instant; 5-active-cards cap). */
export async function POST() {
  try {
    return NextResponse.json({ card: await createVirtualCard() });
  } catch (e) {
    return gatewayError(e);
  }
}

function gatewayError(e: unknown) {
  if (e instanceof GatewayNotConfiguredError) {
    return NextResponse.json({ error: 'gateway_not_configured', detail: e.message }, { status: 503 });
  }
  return NextResponse.json({ error: String(e) }, { status: 502 });
}
