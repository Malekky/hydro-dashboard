import 'server-only';
import { createWalletClient, http, type Account } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';

/**
 * Gnosis Pay PERMISSIONLESS integration (docs.gnosispay.com/integration-model):
 * "This integration requires no special credentials. Simply authenticate with our APIs
 * using SIWE to receive a JWT token." The SIWE signer must be an OWNER of the Gnosis Pay
 * account — i.e., this client authenticates AS THE OPERATOR with their own key.
 *
 * Permissionless tier limits encoded here: no webhooks (we poll transactions), no PAN
 * reveal (operator reads card details in the official Gnosis Pay app), max 5 active cards
 * per account (one virtual card per friend up to that cap).
 *
 * Env: GNOSIS_OPERATOR_PRIVATE_KEY — an owner key of the operator's Gnosis Pay account
 * (server-only; used exclusively to sign SIWE messages, never to move funds).
 *      GNOSIS_SAFE_ADDRESS — the operator's Gnosis Pay Safe (deposit target on Gnosis).
 */

const API_BASE = process.env.GNOSISPAY_API_URL ?? 'https://api.gnosispay.com';
const SIWE_DOMAIN = process.env.GNOSISPAY_SIWE_DOMAIN ?? 'localhost:3000'; // localhost auto-allowed; register hosted domains at partners.gnosispay.com (free)

export class GatewayNotConfiguredError extends Error {
  constructor(what: string) {
    super(`Gateway not configured: ${what}`);
  }
}

export function gatewayConfigured(): boolean {
  return Boolean(process.env.GNOSIS_OPERATOR_PRIVATE_KEY && process.env.GNOSIS_SAFE_ADDRESS);
}

export function gatewaySafeAddress(): `0x${string}` {
  const safe = process.env.GNOSIS_SAFE_ADDRESS;
  if (!safe) throw new GatewayNotConfiguredError('GNOSIS_SAFE_ADDRESS');
  return safe as `0x${string}`;
}

function operatorAccount(): Account {
  const key = process.env.GNOSIS_OPERATOR_PRIVATE_KEY;
  if (!key) throw new GatewayNotConfiguredError('GNOSIS_OPERATOR_PRIVATE_KEY');
  return privateKeyToAccount(key as `0x${string}`);
}

/** JWT cache — Gnosis Pay JWTs live 1-24h; refresh with margin. */
let cachedJwt: { token: string; expiresAt: number } | null = null;

async function api<T>(path: string, init: RequestInit = {}, jwt?: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GnosisPay ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** EIP-4361 sign-in as the operator → Bearer JWT. */
export async function authenticate(): Promise<string> {
  if (cachedJwt && cachedJwt.expiresAt > Date.now() + 60_000) return cachedJwt.token;

  const account = operatorAccount();
  const { nonce } = await api<{ nonce: string }>('/api/v1/auth/nonce');
  const issuedAt = new Date().toISOString();
  const message =
    `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:\n` +
    `${account.address}\n\n` +
    `Sign in to Gnosis Pay.\n\n` +
    `URI: https://${SIWE_DOMAIN}\n` +
    `Version: 1\n` +
    `Chain ID: ${gnosis.id}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${issuedAt}`;

  const walletClient = createWalletClient({ account, chain: gnosis, transport: http() });
  const signature = await walletClient.signMessage({ message });

  const challenge = await api<{ token: string; ttlInSeconds?: number }>('/api/v1/auth/challenge', {
    method: 'POST',
    body: JSON.stringify({ message, signature }),
  });
  cachedJwt = {
    token: challenge.token,
    expiresAt: Date.now() + (challenge.ttlInSeconds ?? 3600) * 1000,
  };
  return cachedJwt.token;
}

export interface GnosisPayCard {
  id: string;
  lastFourDigits?: string;
  statusCode?: number;
  virtual?: boolean;
}

export interface GnosisPayTransaction {
  createdAt?: string;
  clearedAt?: string | null;
  merchant?: { name?: string };
  billingAmount?: string;
  billingCurrency?: { symbol?: string };
  transactionAmount?: string;
  status?: string;
  kind?: string;
  cardToken?: string;
}

export async function listCards(): Promise<GnosisPayCard[]> {
  return api<GnosisPayCard[]>('/api/v1/cards', {}, await authenticate());
}

/** Free + instant per docs; subject to the 5-active-cards account cap. */
export async function createVirtualCard(): Promise<GnosisPayCard> {
  return api<GnosisPayCard>('/api/v1/cards/virtual', { method: 'POST' }, await authenticate());
}

export async function listTransactions(limit = 50): Promise<GnosisPayTransaction[]> {
  return api<GnosisPayTransaction[]>(`/api/v1/cards/transactions?limit=${limit}`, {}, await authenticate());
}
