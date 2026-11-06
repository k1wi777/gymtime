'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { Account, PanelRole } from '@/api/types';
import { useLatest } from '@/lib/use-latest';

interface AuthValue {
  account: Account | null;
  role: PanelRole | null;
  /** `loading` until the first `GET /auth/me` answers. */
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  /** A permissions notice raised by any 403, shown by the shell. */
  forbidden: string | null;
  dismissForbidden: () => void;
  signIn: (account: Account) => void;
  setAccount: (account: Account) => void;
  signOut: () => Promise<void>;
  reload: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

const onLoginPage = (path: string): boolean => path.startsWith('/login');

/**
 * Holds who is signed in. The role lives only in memory: nothing is written
 * to `localStorage`, `sessionStorage` or cookies of our own, and the server
 * (`GET /auth/me`) is the only source of truth for it.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useLatest(pathname);

  const [account, setAccountState] = useState<Account | null>(null);
  const [status, setStatus] = useState<AuthValue['status']>(
    onLoginPage(pathname) ? 'ready' : 'loading',
  );
  const [error, setError] = useState<unknown>();
  const [forbidden, setForbidden] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const { handlers } = getApi();
    handlers.onUnauthorized = () => {
      setAccountState(null);
      if (onLoginPage(pathRef.current)) return;
      const next = encodeURIComponent(pathRef.current);
      router.replace(`/login?aviso=expirada&next=${next}`);
    };
    handlers.onPasswordChangeRequired = () => {
      if (!pathRef.current.startsWith('/cambiar-contrasena')) {
        router.replace('/cambiar-contrasena');
      }
    };
    handlers.onForbidden = (failure) => setForbidden(describeError(failure));
    return () => {
      handlers.onUnauthorized = undefined;
      handlers.onPasswordChangeRequired = undefined;
      handlers.onForbidden = undefined;
    };
  }, [router, pathRef]);

  useEffect(() => {
    if (onLoginPage(pathRef.current)) return;
    const controller = new AbortController();
    setStatus('loading');
    call(getApi().client.GET('/auth/me'))
      .then((me) => {
        if (controller.signal.aborted) return;
        setAccountState(me);
        setStatus('ready');
        if (me.mustChangePassword && !pathRef.current.startsWith('/cambiar')) {
          router.replace('/cambiar-contrasena');
        }
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(failure);
        setStatus('error');
      });
    return () => controller.abort();
  }, [attempt, router, pathRef]);

  const signIn = useCallback((value: Account) => {
    setAccountState(value);
    setError(undefined);
    setStatus('ready');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await call(getApi().client.POST('/auth/logout'));
    } catch {
      // The cookie may already be gone; either way the user leaves.
    }
    setAccountState(null);
    router.replace('/login?aviso=cerrada');
  }, [router]);

  const value = useMemo<AuthValue>(
    () => ({
      account,
      role: account?.role ?? null,
      status,
      error,
      forbidden,
      dismissForbidden: () => setForbidden(null),
      signIn,
      setAccount: setAccountState,
      signOut,
      reload: () => setAttempt((n) => n + 1),
    }),
    [account, status, error, forbidden, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
