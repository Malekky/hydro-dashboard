import 'server-only';

/**
 * Bridge (Stripe) card-issuing client — the USDC→Stripe primary leg (docs/02-design.md §3).
 *
 * Real REST client for api.bridge.xyz. Requires BRIDGE_API_KEY (program approval / KYB —
 * apidocs.bridge.xyz). Without it every call throws BridgeNotConfiguredError and the UI
 * renders the configuration-required state.
 *
 * MVP scope is the INITIAL subscription: create customer (KYC) → issue a virtual Visa in
 * the user's name funded non-custodially from their wallet → user grants the USDC
 * allowance to the funding delegate → user enters the card at claude.ai checkout once.
 * Recurring-cycle allowance choreography is post-MVP (see design §3).
 *
 * NOTE: field names follow the public Bridge docs (kyc_links, card_accounts, JIT funding
 * via delegated ERC-20 approval). Endpoint shapes must be re-verified against
 * apidocs.bridge.xyz once program credentials exist — they are versioned (/v0) and gated.
 */

const BASE_URL = process.env.BRIDGE_API_URL ?? 'https://api.bridge.xyz/v0';

export class BridgeNotConfiguredError extends Error {
  constructor() {
    super('BRIDGE_API_KEY is not configured — Bridge card program credentials required');
  }
}

export interface BridgeKycLink {
  customerId: string;
  kycLink: string;
  tosLink: string;
  kycStatus: string;
}

export interface BridgeCardAccount {
  cardAccountId: string;
  status: string;
  /** Funding delegate the user's wallet must approve USDC to (JIT pull at authorization). */
  fundingDelegateAddress?: `0x${string}`;
  /** Chain the funding wallet lives on. Base assumed per product decision; if Bridge
   *  returns another EVM chain here, the app inserts a bridging tx for the user. */
  chain?: string;
  cardDetails?: { last4?: string; expiry?: string };
}

async function bridgeFetch<T>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<T> {
  const apiKey = process.env.BRIDGE_API_KEY;
  if (!apiKey) throw new BridgeNotConfiguredError();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Api-Key': apiKey,
      'Content-Type': 'application/json',
      ...(init.idempotencyKey ? { 'Idempotency-Key': init.idempotencyKey } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bridge ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json() as Promise<T>;
}

/** Step 1: create the customer + hosted KYC/ToS links (Bridge owns the KYC flow). */
export async function createCustomerWithKyc(input: {
  fullName: string;
  email: string;
  idempotencyKey: string;
}): Promise<BridgeKycLink> {
  const raw = await bridgeFetch<{
    customer_id: string;
    kyc_link: string;
    tos_link: string;
    kyc_status: string;
  }>('/kyc_links', {
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: JSON.stringify({ full_name: input.fullName, email: input.email, type: 'individual' }),
  });
  return {
    customerId: raw.customer_id,
    kycLink: raw.kyc_link,
    tosLink: raw.tos_link,
    kycStatus: raw.kyc_status,
  };
}

export async function getCustomerKycStatus(customerId: string): Promise<string> {
  const raw = await bridgeFetch<{ status: string }>(`/customers/${customerId}`);
  return raw.status;
}

/** Step 2: issue the virtual card, funded non-custodially from the user's wallet. */
export async function createCardAccount(input: {
  customerId: string;
  walletAddress: `0x${string}`;
  idempotencyKey: string;
}): Promise<BridgeCardAccount> {
  const raw = await bridgeFetch<Record<string, unknown>>(`/customers/${input.customerId}/card_accounts`, {
    method: 'POST',
    idempotencyKey: input.idempotencyKey,
    body: JSON.stringify({
      currency: 'usdc',
      // Non-custodial JIT funding from the user's own wallet (Base; bridge-out fallback
      // applies if Bridge designates another EVM chain — design assumption A1).
      funding_source: { type: 'external_wallet', address: input.walletAddress, chain: 'base' },
    }),
  });
  return normalizeCardAccount(raw);
}

export async function getCardAccount(customerId: string, cardAccountId: string): Promise<BridgeCardAccount> {
  const raw = await bridgeFetch<Record<string, unknown>>(`/customers/${customerId}/card_accounts/${cardAccountId}`);
  return normalizeCardAccount(raw);
}

function normalizeCardAccount(raw: Record<string, unknown>): BridgeCardAccount {
  const details = (raw.card_details ?? {}) as Record<string, unknown>;
  const funding = (raw.funding_instructions ?? raw.funding_source ?? {}) as Record<string, unknown>;
  return {
    cardAccountId: String(raw.id ?? raw.card_account_id ?? ''),
    status: String(raw.status ?? 'unknown'),
    fundingDelegateAddress: (funding.delegate_address ?? funding.approval_address) as
      | `0x${string}`
      | undefined,
    chain: funding.chain as string | undefined,
    cardDetails: { last4: details.last_4 as string | undefined, expiry: details.expiry as string | undefined },
  };
}

export function bridgeConfigured(): boolean {
  return Boolean(process.env.BRIDGE_API_KEY);
}
