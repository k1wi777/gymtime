'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/auth/auth-provider';
import { landingFor } from '@/lib/nav';
import { Spinner } from '@/ui/Spinner';

/** The root sends each role to its landing page (the auth provider handles no session). */
export default function Home() {
  const router = useRouter();
  const { account } = useAuth();
  useEffect(() => {
    if (account) router.replace(landingFor(account.role));
  }, [account, router]);
  return <Spinner />;
}
