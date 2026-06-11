import { NextResponse } from 'next/server';
import { GatewayNotConfiguredError, listTransactions } from '@/lib/gateway/gnosisPay';
import { isClaudeCharge, toCharge } from '@/lib/gateway/ledger';

/** Reconciliation feed: recent card transactions, Claude charges pre-extracted. */
export async function GET() {
  try {
    const transactions = await listTransactions(100);
    const claudeCharges = transactions.filter(isClaudeCharge).map(toCharge).filter(Boolean);
    return NextResponse.json({ transactions, claudeCharges });
  } catch (e) {
    if (e instanceof GatewayNotConfiguredError) {
      return NextResponse.json({ error: 'gateway_not_configured', detail: e.message }, { status: 503 });
    }
    return NextResponse.json({ error: String(e) }, { status: 502 });
  }
}
