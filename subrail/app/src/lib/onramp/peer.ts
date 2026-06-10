import type { FundingIntent, OnrampMode, PeerPlatform } from '../types';

/**
 * Peer (zkp2p) onramp adapter — docs/03-spec.md §4.1.
 *
 * Verified constraints (docs/01-research.md §2):
 *  - Web integration is desktop-Chrome only: requires the Peer extension ≥0.6.0; capture via
 *    `peer.authenticate({ captureMode: 'buyerTee' })`, then `fulfillIntent()` from @zkp2p/sdk.
 *  - There is NO extension-free mobile-web flow. Mobile v1 = handoff to Peer's native app
 *    (user onramps to their Subrail wallet address); we detect USDC arrival on Base.
 *  - v1.5 = Expo shell embedding @zkp2p/zkp2p-react-native-sdk (WebView intercept + witness).
 *  - Settlement: USDC on Base (EscrowV2 0x7777…00Ef). Register our builder-fee hook.
 */
export interface PeerOnrampAdapter {
  /** Quote against current maker depth for the corridor. */
  quote(input: { platform: PeerPlatform; usd: number }): Promise<{ spreadBps: number; available: boolean }>;
  /** Start an onramp episode appropriate to the device. */
  start(input: { wallet: `0x${string}`; usd: number; platform?: PeerPlatform; mode: OnrampMode }): Promise<FundingIntent>;
  /** Poll/refresh intent state (extension callback on desktop; Base Transfer watcher on mobile/external). */
  refresh(intent: FundingIntent): Promise<FundingIntent>;
}

export class StubPeerOnrampAdapter implements PeerOnrampAdapter {
  async quote(input: { platform: PeerPlatform; usd: number }) {
    // TODO(M1): read maker depth via @zkp2p/sdk + GraphQL indexer.
    void input;
    return { spreadBps: 100, available: true };
  }

  async start(input: { wallet: `0x${string}`; usd: number; platform?: PeerPlatform; mode: OnrampMode }): Promise<FundingIntent> {
    // TODO(M1): desktop → sdk.initiateOnramp + extension authenticate; mobile/external →
    // render wallet QR/deeplink and arm the Base USDC Transfer watcher (viem watchEvent).
    return {
      id: crypto.randomUUID(),
      wallet: input.wallet,
      mode: input.mode,
      quotedUsd: input.usd,
      state: 'created',
      createdAt: new Date(),
    };
  }

  async refresh(intent: FundingIntent): Promise<FundingIntent> {
    // TODO(M1): state advancement from extension events / chain watcher.
    return intent;
  }
}
