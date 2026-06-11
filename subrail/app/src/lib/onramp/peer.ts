'use client';

import {
  Zkp2pClient,
  createPeerExtensionSdk,
  isPeerExtensionAvailable,
  openPeerExtensionInstallPage,
  type GetQuoteResponse,
  type PeerBuyerTeePaymentCapture,
  type PeerExtensionSdk,
  type QuoteSingleResponse,
} from '@zkp2p/sdk';
import type { Hash, WalletClient } from 'viem';
import { USDC_ADDRESS } from '../chain/usdc';
import type { PeerPlatform } from '../types';

/**
 * Real Peer (zkp2p) taker flow on Base mainnet — desktop web (Chrome extension ≥0.6.0).
 * Sequence: getQuote → signalIntent (locks maker escrow) → user pays fiat out-of-band →
 * extension captures Buyer TEE session → fulfillIntent (attestation + on-chain release).
 *
 * NEXT_PUBLIC_ZKP2P_API_KEY (curator key) enables auto-fetched signalIntent gating
 * signatures and authenticated quotes with resolved payee details. Without it the SDK
 * still quotes, but signalIntent needs a manual gating signature — the UI surfaces that
 * as a configuration-required state. Production should proxy this key server-side.
 */

const ATTESTATION_SERVICE_URL = 'https://attestation.zkp2p.xyz';

/** Subrail builder fee, paid by the taker on fulfillment (25 bps). */
const BUILDER_FEE_BPS = 25n;

export function createPeerClient(walletClient: WalletClient): Zkp2pClient {
  return new Zkp2pClient({
    walletClient,
    chainId: 8453,
    runtimeEnv: 'production',
    apiKey: process.env.NEXT_PUBLIC_ZKP2P_API_KEY || undefined,
  });
}

export function peerExtensionReady(): boolean {
  return isPeerExtensionAvailable();
}

/**
 * Without the curator key, the SDK still quotes but signalIntent can't auto-fetch its
 * gating-service signature — so the embedded checkout is disabled and the UI routes
 * friends to peer.xyz to onramp directly to their wallet address instead.
 */
export function peerEmbeddedCheckoutReady(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_ZKP2P_API_KEY);
}

export { openPeerExtensionInstallPage };

export async function getBestOnrampQuote(
  client: Zkp2pClient,
  input: { platform: PeerPlatform; fiatCurrency: string; usd: number; recipient: `0x${string}` },
): Promise<QuoteSingleResponse | null> {
  const res: GetQuoteResponse = await client.getQuote({
    paymentPlatforms: [input.platform],
    fiatCurrency: input.fiatCurrency,
    user: input.recipient,
    recipient: input.recipient,
    destinationChainId: 8453,
    destinationToken: USDC_ADDRESS,
    amount: input.usd.toFixed(2),
    isExactFiat: true,
  });
  return res.responseObject?.quotes?.[0] ?? null;
}

/** Lock maker liquidity for the quoted intent. Returns the intent hash to fulfill. */
export async function signalQuotedIntent(
  client: Zkp2pClient,
  quote: QuoteSingleResponse,
  recipient: `0x${string}`,
): Promise<Hash> {
  const { intent } = quote;
  const amount = BigInt(intent.amount);
  const feeRecipient = process.env.NEXT_PUBLIC_SUBRAIL_FEE_ADDRESS as `0x${string}` | undefined;
  return client.signalIntent({
    depositId: BigInt(intent.depositId),
    amount,
    toAddress: recipient,
    processorName: intent.processorName,
    payeeDetails: intent.payeeDetails,
    fiatCurrencyCode: intent.fiatCurrencyCode,
    conversionRate: quote.conversionRate,
    referralFees: feeRecipient
      ? [{ recipient: feeRecipient, fee: (amount * BUILDER_FEE_BPS) / 10_000n }]
      : undefined,
  });
}

/**
 * Drive the extension's Buyer TEE capture for the platform the user just paid on.
 * Resolves with the encrypted session capture to feed into fulfillIntent.
 */
export async function captureBuyerPayment(platform: PeerPlatform): Promise<PeerBuyerTeePaymentCapture> {
  const peer: PeerExtensionSdk = createPeerExtensionSdk();
  if ((await peer.getState()) === 'needs_connection') {
    await peer.requestConnection();
  }
  return new Promise((resolve, reject) => {
    const unsubscribe = peer.onMetadataMessage((message) => {
      if (message.buyerTeeCapture) {
        unsubscribe();
        resolve(message.buyerTeeCapture);
      } else if (message.errorMessage) {
        unsubscribe();
        reject(new Error(message.errorMessage));
      }
    });
    try {
      peer.authenticate({
        actionType: `transfer_${platform}`,
        captureMode: 'buyerTee',
        platform,
        attestationServiceUrl: ATTESTATION_SERVICE_URL,
      });
    } catch (e) {
      unsubscribe();
      reject(e);
    }
  });
}

/** Attest + release escrow to the buyer's wallet. Returns the fulfillment tx hash. */
export async function fulfillWithCapture(
  client: Zkp2pClient,
  input: {
    intentHash: `0x${string}`;
    capture: PeerBuyerTeePaymentCapture;
    platform: PeerPlatform;
    onAttestationStart?: () => void;
    onTxSent?: (hash: Hash) => void;
  },
): Promise<Hash> {
  const params = input.capture.params?.[0];
  if (!params) throw new Error('extension returned no payment parameters');
  return client.fulfillIntent({
    intentHash: input.intentHash,
    proof: {
      proofType: 'buyerTee',
      encryptedSessionMaterial: input.capture.encryptedSessionMaterial,
      params,
      actionPlatform: input.platform,
      actionType: `transfer_${input.platform}`,
    },
    attestationServiceUrl: ATTESTATION_SERVICE_URL,
    callbacks: {
      onAttestationStart: input.onAttestationStart,
      onTxSent: input.onTxSent,
    },
  });
}
