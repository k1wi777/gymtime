import type { PanelRole } from '@/api/types';

export interface NavItem {
  href: string;
  label: string;
  /** Roles that see the item and may open the route. */
  roles: readonly PanelRole[];
}

const ALL: readonly PanelRole[] = ['asistente', 'admin'];

/**
 * The menu. Administrator screens (H9) add their entries here with
 * `roles: ['admin']`; the shell and the guards need no change.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/ahora', label: 'Ahora', roles: ALL },
  { href: '/registro', label: 'Registro manual', roles: ALL },
  { href: '/enrolar', label: 'Enrolar huella', roles: ALL },
  { href: '/ordenes', label: 'Alarma y mensajes', roles: ALL },
  { href: '/dispositivo', label: 'Dispositivo', roles: ALL },
  { href: '/horarios', label: 'Horarios', roles: ALL },
];

export const visibleItems = (
  role: PanelRole | null,
  items: readonly NavItem[] = NAV_ITEMS,
): NavItem[] => (role ? items.filter((item) => item.roles.includes(role)) : []);
