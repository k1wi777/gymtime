'use client';

import type { ReactNode } from 'react';
import type { PanelRole } from '@/api/types';
import { Notice } from '@/ui/Notice';
import { useAuth } from './auth-provider';

/** Shows the content only to these roles; anyone else gets a permissions notice. */
export function RequireRole({
  roles,
  children,
}: {
  roles: readonly PanelRole[];
  children: ReactNode;
}) {
  const { role } = useAuth();
  if (role && roles.includes(role)) return <>{children}</>;
  return (
    <Notice kind="error" title="Sin permiso">
      Su rol no permite abrir esta sección. Si la necesita, pida acceso a un
      administrador.
    </Notice>
  );
}
