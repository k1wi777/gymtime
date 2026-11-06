'use client';

import type { ReactNode } from 'react';
import { describeError } from '@/api/errors';
import { useAuth } from '@/auth/auth-provider';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';

/** Waits for `GET /auth/me`; nothing of the panel renders without an account. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { account, status, error, reload } = useAuth();
  if (status === 'error') {
    return (
      <main style={{ padding: '2rem' }}>
        <Notice
          kind="error"
          title="No se pudo verificar la sesión"
          actions={
            <button type="button" className="btn" onClick={reload}>
              Reintentar
            </button>
          }
        >
          {describeError(error)}
        </Notice>
      </main>
    );
  }
  if (status === 'loading' || !account || account.mustChangePassword) {
    return (
      <main style={{ padding: '2rem' }}>
        <Spinner label="Verificando la sesión…" />
      </main>
    );
  }
  return <>{children}</>;
}
