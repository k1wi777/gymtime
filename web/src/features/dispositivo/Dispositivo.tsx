'use client';

import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { useLiveEvents, useResync } from '@/live/live-provider';
import { useResource } from '@/lib/use-resource';
import { formatDateTime } from '@/lib/time';
import { Badge } from '@/ui/Badge';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
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
  return (
    <div className="stack">
      <h1>Dispositivo</h1>
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
      <div className="grid-3">
        {devices.map((device) => {
          const measured = clocks.data?.find(
            (c) => c.deviceId === device.deviceId,
          );
          const clock =
            measured?.clockOffsetSec ??
            (device as { clockOffsetSeconds?: number }).clockOffsetSeconds;
          return (
            <section
              key={device.deviceId}
              className="card stack"
              aria-label={`Lector ${device.deviceId}`}
            >
              <h2>{device.deviceId}</h2>
              <p>
                {device.online ? (
                  <Badge tone="success">En línea</Badge>
                ) : (
                  <Badge tone="danger">Fuera de línea</Badge>
                )}
              </p>
              {measured?.clockWarning && (
                <Notice kind="warning" title="Reloj del lector desfasado">
                  La hora del lector difiere {Math.abs(clock ?? 0)} s de la del
                  servidor (límite {measured.clockThresholdSec} s). Los
                  registros hechos sin conexión usan la hora del lector:
                  corríjala para que las horas sean fiables.
                </Notice>
              )}
              <dl style={{ margin: 0 }}>
                <dt className="muted">Última conexión</dt>
                <dd>
                  {device.lastConnectedAt
                    ? formatDateTime(device.lastConnectedAt)
                    : 'Nunca'}
                </dd>
                <dt className="muted">Versión del firmware</dt>
                <dd>{device.firmwareVersion ?? 'Desconocida'}</dd>
                <dt className="muted">Órdenes pendientes</dt>
                <dd>{device.pendingCommands}</dd>
                {measured?.capabilities.includes('offline') && (
                  <>
                    <dt className="muted">Modo sin conexión</dt>
                    <dd>Disponible</dd>
                  </>
                )}
                {clock !== undefined && clock !== null && (
                  <>
                    <dt className="muted">Desfase del reloj</dt>
                    <dd>{clock} s</dd>
                  </>
                )}
              </dl>
            </section>
          );
        })}
      </div>
    </div>
  );
}
