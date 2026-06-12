import { parseAbiItem, type AbiEvent, type Address, type Hex } from 'viem';

/** Standalone event item for getLogs (avoids const-ABI spread typing issues). */
export const INTENT_OPENED_EVENT: AbiEvent = parseAbiItem(
  'event IntentOpened(bytes32 indexed id, address indexed user, uint8 planRank, uint16 months, uint256 lockedUsdc, uint64 expiry)',
);

/** Minimal ABI for GiftIntentEscrow (contracts/GiftIntentEscrow.sol). */
export const GIFT_ESCROW_ABI = [
  {
    type: 'function', name: 'open', stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'lockedUsdc', type: 'uint256' },
      { name: 'recipientEmailHash', type: 'bytes32' },
      { name: 'planRank', type: 'uint8' },
      { name: 'months', type: 'uint16' },
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'fulfill', stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'refund', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function', name: 'intents', stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [
      { name: 'user', type: 'address' },
      { name: 'lockedUsdc', type: 'uint256' },
      { name: 'recipientEmailHash', type: 'bytes32' },
      { name: 'planRank', type: 'uint8' },
      { name: 'months', type: 'uint16' },
      { name: 'openedAt', type: 'uint64' },
      { name: 'expiry', type: 'uint64' },
      { name: 'state', type: 'uint8' },
    ],
  },
  {
    type: 'event', name: 'IntentOpened',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'planRank', type: 'uint8', indexed: false },
      { name: 'months', type: 'uint16', indexed: false },
      { name: 'lockedUsdc', type: 'uint256', indexed: false },
      { name: 'expiry', type: 'uint64', indexed: false },
    ],
  },
  {
    type: 'event', name: 'IntentFulfilled',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'solver', type: 'address', indexed: true },
      { name: 'orderNullifier', type: 'bytes32', indexed: false },
    ],
  },
] as const;

/** On-chain intent state enum (matches the Solidity `State`). */
export const ESCROW_STATE = ['none', 'open', 'fulfilled', 'refunded'] as const;
export type EscrowStateName = (typeof ESCROW_STATE)[number];

export function escrowAddress(): Address | null {
  const a = process.env.NEXT_PUBLIC_GIFT_ESCROW_ADDRESS;
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as Address) : null;
}

/** Plan ↔ on-chain rank (must match the contract + lib/solver/intent.ts ordering). */
export const PLAN_RANK = { pro: 0, max5x: 1, max20x: 2 } as const;
export const RANK_PLAN = ['pro', 'max5x', 'max20x'] as const;

/** Random 32-byte intent id (client-chosen salt). */
export function newIntentId(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}` as Hex;
}
