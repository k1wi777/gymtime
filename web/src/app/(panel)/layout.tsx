'use client';

import type { ReactNode } from 'react';
import { RequireAuth } from '@/features/shell/RequireAuth';
import { Shell } from '@/features/shell/Shell';
import { LiveProvider } from '@/live/live-provider';

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <LiveProvider>
        <Shell>{children}</Shell>
      </LiveProvider>
    </RequireAuth>
  );
}
