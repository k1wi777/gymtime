'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import type { DeviceStatus } from '@/api/types';
import { useLiveEvents, useResync } from '@/live/live-provider';
import { applyDeviceEvent } from '@/live/reducers';
import { useDebouncedCallback } from '@/lib/use-debounced';
import { useResource } from '@/lib/use-resource';

/** Devices with their live online state: snapshot plus connection events. */
export function useDevices() {
  const resource = useResource(
    (signal) => call(getApi().client.GET('/devices/status', { signal })),
    [],
  );
  // Live events edit a copy; a fresh snapshot replaces it (adjusting state
  // while rendering, the pattern React recommends over an effect).
  const [snapshot, setSnapshot] = useState(resource.data);
  const [devices, setDevices] = useState<DeviceStatus[]>(resource.data ?? []);
  if (resource.data !== snapshot) {
    setSnapshot(resource.data);
    setDevices(resource.data ?? []);
  }

  // The pending-order count only comes from the API: refetch after any order.
  const refresh = useDebouncedCallback(resource.reload, 300);
  useLiveEvents((event) => {
    if (
      event.type === 'device.connected' ||
      event.type === 'device.disconnected' ||
      event.type === 'device.offline_alert'
    ) {
      setDevices((current) => applyDeviceEvent(current, event));
      refresh();
    } else if (event.type === 'command') {
      refresh();
    }
  });
  useResync(resource.reload);

  return { ...resource, devices };
}
