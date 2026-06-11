import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Subrail — subscribe to Claude from anywhere',
  description:
    'Turn local money into a claude.ai subscription: Peer onramp to USDC in your own wallet, a JIT-funded card pays Stripe directly.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          padding: '1.5rem',
          maxWidth: 680,
          marginInline: 'auto',
          background: '#fafaf7',
          color: '#1a1a18',
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
