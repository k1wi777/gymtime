'use client';

import Link from 'next/link';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { formatDay } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { Badge } from '@/ui/Badge';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { formatInt, formatPercent } from './format';
import styles from './Reportes.module.css';

const compliance = (value: number | null): string =>
  value === null ? '—' : formatPercent(value);

function Stat({
  title,
  big,
  children,
}: {
  title: string;
  big: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.stat} aria-label={title}>
      <h3>{title}</h3>
      <div className={styles.big}>{big}</div>
      <p className="muted">{children}</p>
    </section>
  );
}

/** Landing page of the administrator: today, this week, the period and what needs attention. */
export function Resumen() {
  const summary = useResource(
    (signal) => call(getApi().client.GET('/reports/summary', { signal })),
    [],
  );
  const data = summary.data;
  return (
    <div className={styles.page}>
      <h1>Resumen</h1>
      {summary.error !== undefined && (
        <Notice kind="error" title="No se pudo cargar el resumen">
          {describeError(summary.error)}{' '}
          <button type="button" className="btn" onClick={summary.reload}>
            Reintentar
          </button>
        </Notice>
      )}
      {summary.loading && <Spinner label="Cargando resumen…" />}
      {data && (
        <>
          <p className="muted">Hoy es {formatDay(data.date)}.</p>
          <div className={styles.stats}>
            <Stat title="Hoy" big={compliance(data.today.compliance)}>
              Asistieron {formatInt(data.today.attended)} de{' '}
              {formatInt(data.today.obligations)} esperados ·{' '}
              {formatInt(data.today.entries)} entradas ·{' '}
              {formatInt(data.today.inside)} dentro ahora
            </Stat>
            <Stat title="Esta semana" big={compliance(data.week.compliance)}>
              Desde el {formatDay(data.weekStart)}: asistieron{' '}
              {formatInt(data.week.attended)} de{' '}
              {formatInt(data.week.obligations)} esperados ·{' '}
              {formatInt(data.week.entries)} entradas
            </Stat>
            {data.period ? (
              <Stat
                title="Periodo activo"
                big={compliance(data.period.compliance)}
              >
                {data.period.name} ({formatDay(data.period.startDate)} al{' '}
                {formatDay(data.period.endDate)}): asistieron{' '}
                {formatInt(data.period.attended)} de{' '}
                {formatInt(data.period.obligations)} esperados
              </Stat>
            ) : (
              <Stat title="Periodo activo" big="—">
                No hay un periodo activo.
              </Stat>
            )}
          </div>
          <section className="card stack" aria-label="Alertas">
            <h2>Requiere atención</h2>
            <div className={styles.alerts}>
              <div className="row">
                <Badge tone={data.alerts.device.online ? 'success' : 'danger'}>
                  {data.alerts.device.known
                    ? data.alerts.device.online
                      ? 'Lector en línea'
                      : 'Lector sin conexión'
                    : 'Sin lector registrado'}
                </Badge>
                <Badge tone={data.alerts.alarmOn ? 'danger' : 'neutral'}>
                  {data.alerts.alarmOn ? 'Alarma encendida' : 'Alarma apagada'}
                </Badge>
              </div>
              <p>
                Sesiones abiertas en horarios ya terminados:{' '}
                <strong>{formatInt(data.alerts.staleOpen)}</strong>
              </p>
              <p>
                Salidas no registradas (últimos 7 días):{' '}
                <strong>{formatInt(data.alerts.unregistered7d)}</strong>
              </p>
            </div>
          </section>
          <p>
            <Link className="btn btn-primary" href="/admin/reportes">
              Ver reportes
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
