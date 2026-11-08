import type { Metadata } from 'next';
import { Open_Sans, Roboto_Mono, Roboto_Slab } from 'next/font/google';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

// Self-hosted by next/font (variables on <html> so :root can use them): no request to Google at runtime,
// so the CSP (`font-src 'self'`) does not change.
const slab = Roboto_Slab({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-slab',
  display: 'swap',
});
const sans = Open_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});
const mono = Roboto_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GymTime UniCórdoba',
  description: 'Panel de control del gimnasio',
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Reading the request headers makes every page render per request, which is
  // what lets Next stamp its scripts with the CSP nonce set in `proxy.ts`
  // (a prerendered page has no nonce and its scripts would be blocked).
  await headers();
  return (
    <html
      lang="es"
      className={`${slab.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
