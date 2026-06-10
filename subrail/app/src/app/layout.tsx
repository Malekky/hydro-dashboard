import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Subrail — subscribe to Claude from anywhere',
  description:
    'Turn local money into a running claude.ai subscription: Peer onramp to USDC in your own wallet, agentic renewals through the best rail for your country.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '2rem', maxWidth: 640, marginInline: 'auto' }}>
        {children}
      </body>
    </html>
  );
}
