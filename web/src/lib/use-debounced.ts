'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useLatest } from './use-latest';

/** A stable function that runs `fn` once, `ms` after the last call. */
export function useDebouncedCallback(fn: () => void, ms: number): () => void {
  const ref = useLatest(fn);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ref.current(), ms);
  }, [ms, ref]);
}
