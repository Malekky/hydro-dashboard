import { NextResponse } from 'next/server';
import { gatewayConfigured, gatewaySafeAddress } from '@/lib/gateway/gnosisPay';

export async function GET() {
  if (!gatewayConfigured()) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }
  return NextResponse.json({ configured: true, safeAddress: gatewaySafeAddress() });
}
