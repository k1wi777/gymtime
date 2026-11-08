import type { PanelRole } from '@/api/types';
import type { IconName } from '@/ui/icons';

export interface NavItem {
  href: string;
  label: string;
  /** Roles that see the item and may open the route. */
  roles: readonly PanelRole[];
  /** Presentation only: the icon and the group of the side menu. */
  icon: IconName;
  group: NavGroup;
}

export type NavGroup = 'Operación' | 'Control' | 'Administración';

/** Order of the groups in the side menu. */
export const NAV_GROUPS: readonly NavGroup[] = [
  'Operación',
  'Control',
  'Administración',
];

const ALL: readonly PanelRole[] = ['asistente', 'admin'];
const ADMIN: readonly PanelRole[] = ['admin'];

/**
 * The menu. Administrator screens (H9) add their entries here with
 * `roles: ['admin']`; the shell and the guards need no change.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/ahora',
    label: 'Ahora',
    roles: ALL,
    icon: 'ahora',
    group: 'Operación',
  },
  {
    href: '/registro',
    label: 'Registro manual',
    roles: ALL,
    icon: 'registro',
    group: 'Operación',
  },
  {
    href: '/por-revisar',
    label: 'Por revisar',
    roles: ALL,
    icon: 'revisar',
    group: 'Operación',
  },
  {
    href: '/enrolar',
    label: 'Enrolar huella',
    roles: ALL,
    icon: 'huella',
    group: 'Operación',
  },
  {
    href: '/ordenes',
    label: 'Alarma y mensajes',
    roles: ALL,
    icon: 'campana',
    group: 'Control',
  },
  {
    href: '/dispositivo',
    label: 'Dispositivo',
    roles: ALL,
    icon: 'dispositivo',
    group: 'Control',
  },
  {
    href: '/horarios',
    label: 'Horarios',
    roles: ALL,
    icon: 'horarios',
    group: 'Control',
  },
  {
    href: '/admin/resumen',
    label: 'Resumen',
    roles: ADMIN,
    icon: 'resumen',
    group: 'Administración',
  },
  {
    href: '/admin/reportes',
    label: 'Reportes',
    roles: ADMIN,
    icon: 'reportes',
    group: 'Administración',
  },
  {
    href: '/admin/periodos',
    label: 'Periodos',
    roles: ADMIN,
    icon: 'periodos',
    group: 'Administración',
  },
  {
    href: '/admin/horarios',
    label: 'Gestión de horarios',
    roles: ADMIN,
    icon: 'gestionHorarios',
    group: 'Administración',
  },
  {
    href: '/admin/estudiantes',
    label: 'Estudiantes',
    roles: ADMIN,
    icon: 'estudiantes',
    group: 'Administración',
  },
  {
    href: '/admin/historial',
    label: 'Historial',
    roles: ADMIN,
    icon: 'historial',
    group: 'Administración',
  },
  {
    href: '/admin/auditoria',
    label: 'Auditoría',
    roles: ADMIN,
    icon: 'auditoria',
    group: 'Administración',
  },
  {
    href: '/admin/usuarios',
    label: 'Usuarios',
    roles: ADMIN,
    icon: 'usuarios',
    group: 'Administración',
  },
];

export const visibleItems = (
  role: PanelRole | null,
  items: readonly NavItem[] = NAV_ITEMS,
): NavItem[] => (role ? items.filter((item) => item.roles.includes(role)) : []);

/** Where each role lands after signing in: the admin summary, or "Ahora". */
export const landingFor = (role: PanelRole | null): string =>
  role === 'admin' ? '/admin/resumen' : '/ahora';
