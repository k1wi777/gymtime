'use client';

import { describeError } from '@/api/errors';
import { formatDateTime } from '@/lib/time';
import { Badge } from '@/ui/Badge';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { useDevices } from './use-devices';

export function Dispositivo() {
  const { devices, loading, error, reload } = useDevices();
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
          const clock = (device as { clockOffsetSeconds?: number })
            .clockOffsetSeconds;
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
                {clock !== undefined && (
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
