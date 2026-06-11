import { createPublicClient, erc20Abi, http, parseAbiItem, type Address } from 'viem';
import { base } from 'viem/chains';

/** Native USDC on Base mainnet. */
export const USDC_ADDRESS: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const USDC_DECIMALS = 6;

export const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org'),
});

export function usdToUnits(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
}

export function unitsToUsd(units: bigint): number {
  return Number(units) / 10 ** USDC_DECIMALS;
}

export async function getUsdcBalance(wallet: Address): Promise<bigint> {
  return publicClient.readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [wallet],
  });
}

const TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

/**
 * Watch for incoming USDC to `wallet` (funding detection for Peer app-handoff and
 * external deposits). Resolves the unwatch function; caller stops it on completion.
 */
export function watchIncomingUsdc(
  wallet: Address,
  onTransfer: (value: bigint, txHash: `0x${string}`) => void,
): () => void {
  return publicClient.watchEvent({
    address: USDC_ADDRESS,
    event: TRANSFER_EVENT,
    args: { to: wallet },
    poll: true,
    pollingInterval: 4_000,
    onLogs: (logs) => {
      for (const log of logs) {
        if (log.args.value !== undefined) onTransfer(log.args.value, log.transactionHash);
      }
    },
  });
}
