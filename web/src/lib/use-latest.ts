'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';

/** A ref that always holds the value of the last committed render. */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
