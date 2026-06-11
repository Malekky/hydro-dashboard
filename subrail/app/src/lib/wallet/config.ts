'use client';

import { http, createConfig } from 'wagmi';
import { base } from 'wagmi/chains';
import { coinbaseWallet } from 'wagmi/connectors';

/**
 * Base mainnet only (product decision: no testnet). Coinbase Smart Wallet in
 * smart-wallet-only mode gives the passkey onboarding flow (docs/02-design.md D4).
 */
export const wagmiConfig = createConfig({
  chains: [base],
  connectors: [
    coinbaseWallet({
      appName: 'Subrail',
      preference: 'smartWalletOnly',
    }),
  ],
  transports: {
    [base.id]: http(process.env.NEXT_PUBLIC_BASE_RPC_URL ?? 'https://mainnet.base.org'),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
