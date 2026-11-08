'use client';

import { useLive } from '@/live/live-provider';
import styles from './ConnectionPill.module.css';

const LABELS = {
  connecting: 'conectando',
  connected: 'conectado',
  reconnecting: 'reconectando',
  disconnected: 'desconectado',
} as const;

/** Rounded pill of the page headers: green dot while the state is good. */
export function ConnectionPill({
  label,
  online,
}: {
  label: string;
  online: boolean;
}) {
  return (
    <div className={styles.pill}>
      <span
        aria-hidden="true"
        className={online ? styles.dot : `${styles.dot} ${styles.off}`}
      />
      {label}
    </div>
  );
}

/** The pill of «Ahora»: state of the live link with the panel. */
export function LivePill() {
  const { state } = useLive();
  return (
    <ConnectionPill
      label={`En vivo: ${LABELS[state]}`}
      online={state === 'connected'}
    />
  );
}
