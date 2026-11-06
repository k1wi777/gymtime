'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { useLiveEvents, useResync } from '@/live/live-provider';
import { ALARM_REASON_LABELS } from '@/lib/labels';
import { useResource } from '@/lib/use-resource';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { Notice } from '@/ui/Notice';
import styles from './AlarmBanner.module.css';

const closedMessage = (count: number): string =>
  count === 0
    ? 'Alarma apagada. No había sesiones abiertas.'
    : `Alarma apagada. ${count} ${count === 1 ? 'sesión quedó cerrada' : 'sesiones quedaron cerradas'} como no registradas.`;

/**
 * Shown on every screen while the siren sounds. Turning it off asks for
 * confirmation because it closes the open sessions as «no registrada».
 */
export function AlarmBanner() {
  const status = useResource(
    (signal) => call(getApi().client.GET('/alarm/status', { signal })),
    [],
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  useLiveEvents((event) => {
    if (event.type !== 'alarm') return;
    status.reload();
    const { on, closedBy, sessionsClosed } = event.data;
    // Silenced by the reader's button or by the timeout, not from this screen.
    if (!on && closedBy && closedBy !== 'all_exited') {
      setOutcome(closedMessage(sessionsClosed));
    }
  });
  useResync(status.reload);

  const turnOff = async (): Promise<void> => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await call(getApi().client.POST('/alarm/off'));
      setOutcome(closedMessage(result.sessionsClosed));
      setConfirming(false);
      status.reload();
    } catch (error) {
      setConfirming(false);
      setFailure(describeError(error));
      status.reload();
    } finally {
      setBusy(false);
    }
  };

  const alarm = status.data;
  return (
    <>
      {alarm?.on && (
        <div className={styles.banner} role="alert">
          <div>
            <strong className={styles.title}>ALARMA SONANDO</strong>
            <div>
              {ALARM_REASON_LABELS[alarm.reason ?? 'MANUAL'] ?? 'Alarma'}
              {alarm.openSessions > 0 &&
                ` · ${alarm.openSessions} ${alarm.openSessions === 1 ? 'persona sigue dentro' : 'personas siguen dentro'}`}
            </div>
          </div>
          <button
            type="button"
            className="btn"
            onClick={() => setConfirming(true)}
          >
            Apagar alarma
          </button>
        </div>
      )}
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}
      {outcome && (
        <Notice kind="success" onDismiss={() => setOutcome(null)}>
          {outcome}
        </Notice>
      )}
      <ConfirmDialog
        open={confirming}
        title="¿Apagar la alarma?"
        tone="danger"
        confirmLabel="Apagar alarma"
        busy={busy}
        onConfirm={() => void turnOff()}
        onCancel={() => setConfirming(false)}
      >
        <p>
          {alarm && alarm.openSessions > 0
            ? `Hay ${alarm.openSessions} ${alarm.openSessions === 1 ? 'sesión abierta' : 'sesiones abiertas'}: al apagar la alarma se cerrarán como «no registrada» (sin hora de salida).`
            : 'Se silenciará la sirena del lector.'}
        </p>
      </ConfirmDialog>
    </>
  );
}
