'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { useLiveEvents, useResync } from '@/live/live-provider';
import { useResource } from '@/lib/use-resource';

/**
 * Offline events waiting for a person: the count of the API, kept live by the
 * `offline.review` event (it carries the new total, so there is no refetch).
 */
export function useReviewCount(): number {
  const resource = useResource(
    (signal) => call(getApi().client.GET('/offline/review/count', { signal })),
    [],
  );
  const [live, setLive] = useState<number | null>(null);
  const [seen, setSeen] = useState(resource.data);
  // A fresh snapshot wins over what the stream said before it.
  if (resource.data !== seen) {
    setSeen(resource.data);
    setLive(null);
  }
  useLiveEvents((event) => {
    if (event.type === 'offline.review') setLive(event.data.pending);
  });
  useResync(resource.reload);
  return live ?? resource.data?.pending ?? 0;
}
