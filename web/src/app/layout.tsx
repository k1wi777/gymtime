import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import './globals.css';

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
    <html lang="es">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
