'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/auth/auth-provider';
import { AlarmBanner } from '@/features/alarma/AlarmBanner';
import { useDevices } from '@/features/dispositivo/use-devices';
import { useReviewCount } from '@/features/offline/use-review-count';
import { formatTime } from '@/lib/time';
import { useLive } from '@/live/live-provider';
import { BRAND } from '@/lib/brand';
import { initialsOf } from '@/lib/display';
import { NAV_GROUPS, visibleItems } from '@/lib/nav';
import { Icon } from '@/ui/icons';
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
  const pending = useReviewCount();
  const offline = devices.filter((device) => !device.online);
  const alerted = offline.filter((device) => device.offlineAlert);
  const waiting = offline.filter((device) => !device.offlineAlert);

  useEffect(() => {
    document.title =
      offline.length > 0 ? `⚠ Lector fuera de línea · ${TITLE}` : TITLE;
  }, [offline.length]);

  const items = visibleItems(role);
  return (
    <div className={styles.layout}>
      <aside className={styles.aside}>
        <img
          src={BRAND.crestWatermark}
          alt=""
          aria-hidden="true"
          className={styles.watermark}
        />
        <div className={styles.brand}>
          <div className={styles.sealBox}>
            <img
              src={BRAND.seal}
              alt="Escudo de la Universidad de Córdoba"
              className={styles.seal}
            />
          </div>
          <div className={styles.brandText}>
            <div className={styles.brandName}>GymTime</div>
            <div className={styles.brandSub}>Universidad de Córdoba</div>
          </div>
        </div>
        <nav aria-label="Secciones" className={styles.nav}>
          {NAV_GROUPS.map((group) => {
            const inGroup = items.filter((item) => item.group === group);
            if (inGroup.length === 0) return null;
            return (
              <div key={group} className={styles.group}>
                <div className={styles.groupTitle}>{group}</div>
                {inGroup.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={
                      pathname.startsWith(item.href) ? 'page' : undefined
                    }
                    className={styles.link}
                  >
                    <Icon name={item.icon} />
                    <span className={styles.label}>{item.label}</span>
                    {item.href === '/por-revisar' && pending > 0 && (
                      <span
                        className={styles.counter}
                        aria-label={`${pending} por revisar`}
                      >
                        {pending}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className={styles.user}>
          <div className={styles.who}>
            <div aria-hidden="true" className={styles.avatar}>
              {initialsOf(account?.name ?? '')}
            </div>
            <div className={styles.whoText}>
              <div className={styles.name}>{account?.name}</div>
              <div className={styles.role}>
                {role === 'admin' ? 'Administrador' : 'Asistente'}
              </div>
            </div>
          </div>
          <div className={styles.userActions}>
            <ConnectionBadge />
            <button
              type="button"
              className={styles.signOut}
              onClick={() => void signOut()}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </aside>
      <div className={styles.content}>
        <main className={styles.main}>
          <div className={styles.alerts}>
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
            {alerted.map((device) => (
              <Notice
                key={device.deviceId}
                kind="error"
                title="Lector sin conexión"
              >
                El lector «{device.deviceId}» lleva más de{' '}
                {device.alertThresholdMinutes} min fuera de línea
                {device.offlineSince
                  ? ` (desde las ${formatTime(device.offlineSince)})`
                  : ''}
                . Nadie puede registrar su huella: use el registro manual y
                revise la red y la alimentación del lector. El aviso desaparece
                cuando vuelva a conectarse.
              </Notice>
            ))}
            {waiting.map((device) => (
              <Notice
                key={device.deviceId}
                kind="warning"
                title="Lector fuera de línea"
              >
                El lector «{device.deviceId}» no está conectado. Las huellas no
                se registrarán hasta que vuelva a conectarse.
              </Notice>
            ))}
            {state === 'disconnected' && (
              <Notice kind="warning" title="Sin conexión en vivo">
                Los datos de la pantalla pueden estar desactualizados. El panel
                sigue intentando reconectar.
              </Notice>
            )}
          </div>
          <div className={styles.page}>{children}</div>
        </main>
      </div>
    </div>
  );
}
