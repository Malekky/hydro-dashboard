import { NextRequest, NextResponse } from 'next/server';
import { encodeRequirementsHeader, feeRequirements, settleWithFacilitator } from '@/lib/pay/x402';

const FEE_USD = 1.5;
const FEE_ADDRESS = (process.env.SUBRAIL_FEE_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;

/**
 * x402-gated service-fee endpoint (docs/03-spec.md §4.5): GET without payment → 402 with
 * requirements; retry with PAYMENT-SIGNATURE → facilitator settles → receipt.
 */
export async function GET(req: NextRequest) {
  const signature = req.headers.get('payment-signature');
  if (!signature) {
    return new NextResponse(null, {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': encodeRequirementsHeader(feeRequirements({ payTo: FEE_ADDRESS, usd: FEE_USD })) },
    });
  }
  const result = await settleWithFacilitator(signature).catch((e: Error) => ({ ok: false as const, error: e.message }));
  if (!result.ok) return NextResponse.json(result, { status: 502 });
  return NextResponse.json({ receipt: result });
}
