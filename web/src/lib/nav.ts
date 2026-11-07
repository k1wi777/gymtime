import type { PanelRole } from '@/api/types';

export interface NavItem {
  href: string;
  label: string;
  /** Roles that see the item and may open the route. */
  roles: readonly PanelRole[];
}

const ALL: readonly PanelRole[] = ['asistente', 'admin'];
const ADMIN: readonly PanelRole[] = ['admin'];

/**
 * The menu. Administrator screens (H9) add their entries here with
 * `roles: ['admin']`; the shell and the guards need no change.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/ahora', label: 'Ahora', roles: ALL },
  { href: '/registro', label: 'Registro manual', roles: ALL },
  { href: '/por-revisar', label: 'Por revisar', roles: ALL },
  { href: '/enrolar', label: 'Enrolar huella', roles: ALL },
  { href: '/ordenes', label: 'Alarma y mensajes', roles: ALL },
  { href: '/dispositivo', label: 'Dispositivo', roles: ALL },
  { href: '/horarios', label: 'Horarios', roles: ALL },
  { href: '/admin/resumen', label: 'Resumen', roles: ADMIN },
  { href: '/admin/reportes', label: 'Reportes', roles: ADMIN },
  { href: '/admin/periodos', label: 'Periodos', roles: ADMIN },
  { href: '/admin/horarios', label: 'Gestión de horarios', roles: ADMIN },
  { href: '/admin/estudiantes', label: 'Estudiantes', roles: ADMIN },
  { href: '/admin/historial', label: 'Historial', roles: ADMIN },
  { href: '/admin/auditoria', label: 'Auditoría', roles: ADMIN },
  { href: '/admin/usuarios', label: 'Usuarios', roles: ADMIN },
];

export const visibleItems = (
  role: PanelRole | null,
  items: readonly NavItem[] = NAV_ITEMS,
): NavItem[] => (role ? items.filter((item) => item.roles.includes(role)) : []);

/** Where each role lands after signing in: the admin summary, or "Ahora". */
export const landingFor = (role: PanelRole | null): string =>
  role === 'admin' ? '/admin/resumen' : '/ahora';
