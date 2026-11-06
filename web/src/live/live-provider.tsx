'use client';

import { useRouter, usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, call, getApi } from '@/api/client';
import type { SystemEvent } from '@/api/types';
import { apiUrl } from '@/lib/env';
import { trackActivity } from '@/lib/activity';
import { useLatest } from '@/lib/use-latest';
import { applyCommand, type CommandEntry } from './reducers';
import { SseClient, type ConnectionState } from './sse-client';

interface LiveValue {
  state: ConnectionState;
  /** Last commands seen on the stream (newest first), kept across screens. */
  commands: readonly CommandEntry[];
  subscribe: (handler: (event: SystemEvent) => void) => () => void;
  onResync: (handler: () => void) => () => void;
}

const LiveContext = createContext<LiveValue | null>(null);

export function useLive(): LiveValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error('useLive must be used inside <LiveProvider>');
  return value;
}

/** Runs `handler` for every stream event; always sees the latest closure. */
export function useLiveEvents(handler: (event: SystemEvent) => void): void {
  const { subscribe } = useLive();
  const ref = useLatest(handler);
  useEffect(() => subscribe((event) => ref.current(event)), [subscribe, ref]);
}

/** Runs `handler` when the stream (re)connects: reload the snapshot there. */
export function useResync(handler: () => void): void {
  const { onResync } = useLive();
  const ref = useLatest(handler);
  useEffect(() => onResync(() => ref.current()), [onResync, ref]);
}

/**
 * Owns the single SSE connection of the panel and the renewal of the session
 * with the user's activity (the stream's heartbeat does not renew it).
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useLatest(pathname);
  const routerRef = useLatest(router);

  // One stable instance: children subscribe from their first effect, which
  // runs before this component's own effect starts the stream.
  const [sse] = useState(
    () =>
      new SseClient({
        url: `${apiUrl()}/events`,
        probe: async () => {
          try {
            await call(getApi().client.GET('/auth/me'));
            return 'ok';
          } catch (error) {
            return error instanceof ApiError && error.status === 401
              ? 'unauthorized'
              : 'error';
          }
        },
      }),
  );
  const [state, setState] = useState<ConnectionState>(sse.state);
  const [commands, setCommands] = useState<readonly CommandEntry[]>([]);

  useEffect(() => {
    const offState = sse.onState(setState);
    const offUnauthorized = sse.onUnauthorized(() => {
      const next = encodeURIComponent(pathRef.current);
      routerRef.current.replace(`/login?aviso=expirada&next=${next}`);
    });
    const offEvent = sse.onEvent((event) => {
      if (event.type === 'command') {
        setCommands((list) => applyCommand(list, event));
      }
    });
    sse.start();
    const stopActivity = trackActivity({
      touch: () => call(getApi().client.GET('/auth/me')),
    });
    return () => {
      stopActivity();
      offState();
      offUnauthorized();
      offEvent();
      sse.stop();
    };
  }, [sse, pathRef, routerRef]);

  // Stable, so a state change does not make every screen resubscribe.
  const subscribe = useCallback(
    (handler: (event: SystemEvent) => void) => sse.onEvent(handler),
    [sse],
  );
  const onResync = useCallback(
    (handler: () => void) => sse.onResync(handler),
    [sse],
  );
  const value = useMemo<LiveValue>(
    () => ({ state, commands, subscribe, onResync }),
    [state, commands, subscribe, onResync],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
