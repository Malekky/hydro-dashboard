/**
 * Friend-contribution funding route: Base USDC (friend's wallet) → EURe on Gnosis Chain,
 * delivered DIRECTLY to the operator's Gnosis Pay Safe (deposits are plain ERC-20
 * transfers — permissionless, instant, no Delay-module involvement).
 *
 * Route source: LI.FI quote API (keyless for standard volume) — one of the aggregators
 * Gnosis Pay's own docs recommend for cross-chain top-ups (gp-onchain/third-party-bridges).
 * IMPORTANT: an EEA/UK Safe spends EURe only — never deliver USDC.e to it.
 */

import { USDC_ADDRESS, usdToUnits } from '../chain/usdc';

const LIFI_QUOTE_URL = 'https://li.quest/v1/quote';
const BASE_CHAIN_ID = 8453;
const GNOSIS_CHAIN_ID = 100;
/** Resolved by LI.FI by symbol; pin the EURe contract address here at config time. */
const GNOSIS_EURE = process.env.NEXT_PUBLIC_GNOSIS_EURE_TOKEN ?? 'EURe';

export interface FundingQuote {
  /** Tx for the friend's wallet to execute on Base. */
  transactionRequest: { to: `0x${string}`; data: `0x${string}`; value?: string };
  /** If set, USDC must first be approved to this spender on Base. */
  approvalAddress?: `0x${string}`;
  fromAmountUsdc: string;
  estimatedEure: string;
  toolName?: string;
}

export async function getFundingQuote(input: {
  friendWallet: `0x${string}`;
  safeAddress: `0x${string}`;
  usd: number;
}): Promise<FundingQuote> {
  const params = new URLSearchParams({
    fromChain: String(BASE_CHAIN_ID),
    toChain: String(GNOSIS_CHAIN_ID),
    fromToken: USDC_ADDRESS,
    toToken: GNOSIS_EURE,
    fromAmount: usdToUnits(input.usd).toString(),
    fromAddress: input.friendWallet,
    toAddress: input.safeAddress,
  });
  const res = await fetch(`${LIFI_QUOTE_URL}?${params}`);
  if (!res.ok) {
    throw new Error(`LI.FI quote failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const quote = (await res.json()) as {
    transactionRequest: { to: `0x${string}`; data: `0x${string}`; value?: string };
    estimate: { approvalAddress?: `0x${string}`; toAmount: string };
    toolDetails?: { name?: string };
  };
  return {
    transactionRequest: quote.transactionRequest,
    approvalAddress: quote.estimate.approvalAddress,
    fromAmountUsdc: usdToUnits(input.usd).toString(),
    estimatedEure: quote.estimate.toAmount,
    toolName: quote.toolDetails?.name,
  };
}
