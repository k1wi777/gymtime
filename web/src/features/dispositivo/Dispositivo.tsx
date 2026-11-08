'use client';

import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { useLiveEvents, useResync } from '@/live/live-provider';
import { useResource } from '@/lib/use-resource';
import { formatDateTime } from '@/lib/time';
import { Badge } from '@/ui/Badge';
import { Notice } from '@/ui/Notice';
import { Icon } from '@/ui/icons';
import { PageHeader } from '@/ui/PageHeader';
import { Spinner } from '@/ui/Spinner';
import { ConnectionPill } from '@/features/shell/ConnectionPill';
import styles from './Dispositivo.module.css';
import { useDevices } from './use-devices';

export function Dispositivo() {
  const { devices, loading, error, reload } = useDevices();
  // Clock offset and offline capability of each reader (H12). It is extra
  // information: if it cannot be read the screen shows the rest as before.
  const clocks = useResource(
    (signal) => call(getApi().client.GET('/offline/clock', { signal })),
    [],
  );
  useLiveEvents((event) => {
    if (event.type === 'device.clock_skew') clocks.reload();
  });
  useResync(clocks.reload);
  const anyOnline = devices.some((device) => device.online);
  return (
    <>
      <PageHeader
        eyebrow="Asistente · Lector de huellas"
        title="Dispositivo"
        aside={
          <>
            {devices.length > 0 && (
              <ConnectionPill
                label={anyOnline ? 'Conectado' : 'Sin conexión'}
                online={anyOnline}
              />
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                reload();
                clocks.reload();
              }}
            >
              Actualizar estado
            </button>
          </>
        }
      />
      <div className={styles.body}>
        {loading && <Spinner />}
        {error && !loading ? (
          <Notice
            kind="error"
            title="No se pudo cargar el estado del lector"
            actions={
              <button type="button" className="btn" onClick={reload}>
                Reintentar
              </button>
            }
          >
            {describeError(error)}
          </Notice>
        ) : null}
        {!loading && !error && devices.length === 0 && (
          <Notice kind="info">
            Todavía no se ha conectado ningún lector. Cuando lo haga aparecerá
            aquí.
          </Notice>
        )}
        {devices.map((device) => {
          const measured = clocks.data?.find(
            (c) => c.deviceId === device.deviceId,
          );
          const clock =
            measured?.clockOffsetSec ??
            (device as { clockOffsetSeconds?: number }).clockOffsetSeconds;
          const metrics: Array<{
            term: string;
            value: string;
            small?: boolean;
          }> = [
            {
              term: 'Última conexión',
              value: device.lastConnectedAt
                ? formatDateTime(device.lastConnectedAt)
                : 'Nunca',
              small: true,
            },
            {
              term: 'Versión del firmware',
              value: device.firmwareVersion ?? 'Desconocida',
              small: true,
            },
            {
              term: 'Órdenes pendientes',
              value: String(device.pendingCommands),
            },
            ...(measured?.capabilities.includes('offline')
              ? [
                  {
                    term: 'Modo sin conexión',
                    value: 'Disponible',
                    small: true,
                  },
                ]
              : []),
            ...(clock !== undefined && clock !== null
              ? [{ term: 'Desfase del reloj', value: `${clock} s` }]
              : []),
          ];
          return (
            <div key={device.deviceId} className={styles.device}>
              <section
                className={styles.hero}
                aria-label={`Lector ${device.deviceId}`}
              >
                <div className={styles.heroMain}>
                  <div aria-hidden="true" className={styles.heroIcon}>
                    <Icon name="lector" size={40} strokeWidth={1.5} />
                  </div>
                  <div>
                    <div className={styles.kicker}>Lector</div>
                    <h2 className={styles.deviceId}>{device.deviceId}</h2>
                    {device.firmwareVersion && (
                      <div className={styles.firmware}>
                        Programa {device.firmwareVersion}
                      </div>
                    )}
                  </div>
                </div>
                <div className={styles.heroState}>
                  {device.online ? (
                    <Badge tone="success">En línea</Badge>
                  ) : (
                    <Badge tone="danger">Fuera de línea</Badge>
                  )}
                </div>
              </section>
              <dl className={styles.metrics}>
                {metrics.map((metric, index) => (
                  <div
                    key={metric.term}
                    className={`${styles.metric} ${styles[`m${(index % 4) + 1}`]}`}
                  >
                    <span aria-hidden="true" className={styles.bar} />
                    <dt className={styles.term}>{metric.term}</dt>
                    <dd
                      className={`${styles.value} ${metric.small ? styles.valueSmall : ''}`}
                    >
                      {metric.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {(measured?.clockWarning ||
                (clock !== undefined && clock !== null)) && (
                <section
                  className={`card ${styles.clock}`}
                  aria-label={`Reloj de ${device.deviceId}`}
                >
                  <h2>Reloj del lector</h2>
                  {measured?.clockWarning ? (
                    <Notice kind="warning" title="Reloj del lector desfasado">
                      La hora del lector difiere {Math.abs(clock ?? 0)} s de la
                      del servidor (límite {measured.clockThresholdSec} s). Los
                      registros hechos sin conexión usan la hora del lector:
                      corríjala para que las horas sean fiables.
                    </Notice>
                  ) : (
                    <div className={styles.sync}>
                      <Icon name="check" size={18} strokeWidth={2.4} />
                      Sincronizado con el servidor · diferencia de{' '}
                      {Math.abs(clock ?? 0)} s
                    </div>
                  )}
                  <p className={styles.clockText}>
                    Si la diferencia supera el límite, el panel lo avisa y
                    conviene revisar la hora del lector.
                  </p>
                </section>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
