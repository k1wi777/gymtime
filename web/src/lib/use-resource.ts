'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLatest } from './use-latest';

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  /** True until the first answer (data or error) arrives. */
  loading: boolean;
  reload: () => void;
}

/**
 * Loads data from the browser and cancels the request when the inputs change
 * or the component goes away. A reload keeps the old data on screen.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loadRef = useLatest(load);

  useEffect(() => {
    const controller = new AbortController();
    loadRef
      .current(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setData(value);
        setError(undefined);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setError(failure);
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });
    return () => controller.abort();
    // The caller owns the dependency list (plus the manual reload counter).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRef, version, ...deps]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload };
}
