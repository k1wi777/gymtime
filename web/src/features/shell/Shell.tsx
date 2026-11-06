'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/auth/auth-provider';
import { AlarmBanner } from '@/features/alarma/AlarmBanner';
import { useDevices } from '@/features/dispositivo/use-devices';
import { useLive } from '@/live/live-provider';
import { visibleItems } from '@/lib/nav';
import { Notice } from '@/ui/Notice';
import { ConnectionBadge } from './ConnectionBadge';
import styles from './Shell.module.css';

const TITLE = 'GymTime UniCórdoba';

/** Menu by role, live link state, global alarm and offline-reader notices. */
export function Shell({ children }: { children: ReactNode }) {
  const { account, role, signOut, forbidden, dismissForbidden } = useAuth();
  const pathname = usePathname();
  const { state } = useLive();
  const { devices } = useDevices();
  const offline = devices.filter((device) => !device.online);

  useEffect(() => {
    document.title =
      offline.length > 0 ? `⚠ Lector fuera de línea · ${TITLE}` : TITLE;
  }, [offline.length]);

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <strong className={styles.brand}>GymTime</strong>
        <nav aria-label="Secciones" className={styles.nav}>
          {visibleItems(role).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname.startsWith(item.href) ? 'page' : undefined}
              className={styles.link}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.user}>
          <ConnectionBadge />
          <span>
            {account?.name}{' '}
            <span className="muted">
              ({role === 'admin' ? 'administrador' : 'asistente'})
            </span>
          </span>
          <button type="button" className="btn" onClick={() => void signOut()}>
            Cerrar sesión
          </button>
        </div>
      </header>
      <main className={styles.main}>
        <div className="stack">
          <AlarmBanner />
          {forbidden && (
            <Notice
              kind="error"
              title="Sin permiso"
              onDismiss={dismissForbidden}
            >
              {forbidden}
            </Notice>
          )}
          {offline.map((device) => (
            <Notice
              key={device.deviceId}
              kind="warning"
              title="Lector fuera de línea"
            >
              El lector «{device.deviceId}» no está conectado. Las huellas no se
              registrarán hasta que vuelva a conectarse.
            </Notice>
          ))}
          {state === 'disconnected' && (
            <Notice kind="warning" title="Sin conexión en vivo">
              Los datos de la pantalla pueden estar desactualizados. El panel
              sigue intentando reconectar.
            </Notice>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
