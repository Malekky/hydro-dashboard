import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Providers } from '@/components/Providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Subrail — keep your Claude subscription paid, from anywhere',
  description:
    'Turn the money you already have into a running claude.ai subscription. Fund your own wallet with USDC, contribute to your gateway, and the subscription stays paid.',
};

export const viewport: Viewport = {
  themeColor: '#faf9f5',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <header className="nav">
          <div className="nav-inner">
            <Link className="wordmark" href="/">
              <span className="dot" aria-hidden />
              Subrail
            </Link>
            <nav className="nav-links" aria-label="Main">
              <Link href="/">Get started</Link>
              <Link href="/operator">Operator</Link>
            </nav>
          </div>
        </header>
        <div className="shell">
          <Providers>{children}</Providers>
          <footer className="footer">
            Subrail is an independent tool and is not affiliated with Anthropic. Not available
            in sanctioned or Claude-unsupported regions. Your funds stay in your own wallet
            until you contribute them.
          </footer>
        </div>
      </body>
    </html>
  );
}
