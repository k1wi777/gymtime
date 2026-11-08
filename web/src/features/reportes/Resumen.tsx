'use client';

import Link from 'next/link';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { ConnectionPill } from '@/features/shell/ConnectionPill';
import { formatDay } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { Icon, type IconName } from '@/ui/icons';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { Spinner } from '@/ui/Spinner';
import { formatDecimal, formatInt, formatPercent } from './format';
import styles from './Resumen.module.css';

const width = (value: number | null): string =>
  `${Math.min(100, Math.max(0, value ?? 0))}%`;

function Stat({
  title,
  icon,
  compliance,
  children,
}: {
  title: string;
  icon: IconName;
  compliance: number | null;
  children: React.ReactNode;
}) {
  return (
    <section className={`card ${styles.stat}`} aria-label={title}>
      <div className={styles.statHead}>
        <span aria-hidden="true" className={styles.statIcon}>
          <Icon name={icon} size={20} />
        </span>
        <h2 className={styles.statTitle}>{title}</h2>
      </div>
      {compliance === null ? (
        <div className={`${styles.statFigure} ${styles.statNone}`}>—</div>
      ) : (
        <>
          <div className={styles.statFigure}>{formatPercent(compliance)}</div>
          <div className={styles.trackThin}>
            <div
              className={styles.fillAccent}
              style={{ width: width(compliance) }}
            />
          </div>
        </>
      )}
      <p className={styles.statText}>{children}</p>
    </section>
  );
}

/** Landing page of the administrator: today, this week, the period and what needs attention. */
export function Resumen() {
  const summary = useResource(
    (signal) => call(getApi().client.GET('/reports/summary', { signal })),
    [],
  );
  // Only for the number of schedules of the active period (not in the summary).
  const periods = useResource(
    (signal) => call(getApi().client.GET('/periods', { signal })),
    [],
  );
  const data = summary.data;
  const schedulesCount = data?.period
    ? periods.data?.find(
        (period) =>
          period.active &&
          period.name === data.period?.name &&
          period.startDate === data.period.startDate,
      )?.schedulesCount
    : undefined;
  const device = data?.alerts.device;
  const deviceLabel = device
    ? device.known
      ? device.online
        ? 'Lector en línea'
        : 'Lector sin conexión'
      : 'Sin lector registrado'
    : '';
  return (
    <div>
      <PageHeader
        crumb="Resumen"
        title="Resumen"
        {...(data ? { lead: `Hoy es ${formatDay(data.date)}.` } : {})}
        aside={
          device?.known ? (
            <ConnectionPill
              label={deviceLabel}
              online={device.online}
              warning={!device.online}
            />
          ) : undefined
        }
      />
      <div className={styles.main}>
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
            <section
              className={`card ${styles.period}`}
              aria-label="Periodo activo"
            >
              <div className={styles.periodMain}>
                <div className={styles.eyebrow}>Periodo activo</div>
                {data.period ? (
                  <>
                    <h2 className={styles.periodName}>{data.period.name}</h2>
                    <div className={styles.periodDates}>
                      Del {formatDay(data.period.startDate)} al{' '}
                      {formatDay(data.period.endDate)}
                      {schedulesCount !== undefined &&
                        ` · ${schedulesCount} horario(s)`}
                    </div>
                  </>
                ) : (
                  <h2 className={styles.periodName}>
                    No hay un periodo activo.
                  </h2>
                )}
                <Link
                  className={`btn btn-primary ${styles.cta}`}
                  href="/admin/reportes"
                >
                  Ver reportes
                  <Icon name="flecha" size={16} strokeWidth={2} />
                </Link>
              </div>
              {data.period && (
                <div className={styles.progress}>
                  {data.period.compliance === null ? (
                    <div className={styles.bigRow}>
                      <span className={styles.bigNumber}>—</span>
                      <span className={styles.bigNote}>de asistencia</span>
                    </div>
                  ) : (
                    <div className={styles.bigRow}>
                      <span className={styles.bigNumber}>
                        {formatDecimal(data.period.compliance)}
                      </span>
                      <span className={styles.bigUnit}>%</span>
                      <span className={styles.bigNote}>de asistencia</span>
                    </div>
                  )}
                  <div className={styles.track}>
                    <div
                      className={styles.fill}
                      style={{ width: width(data.period.compliance) }}
                    />
                  </div>
                  <div className={styles.counts}>
                    <span>
                      <strong>{formatInt(data.period.attended)}</strong>{' '}
                      asistieron
                    </span>
                    <span>
                      <strong>{formatInt(data.period.obligations)}</strong>{' '}
                      esperados
                    </span>
                  </div>
                </div>
              )}
            </section>

            <div className={styles.pair}>
              <Stat title="Hoy" icon="ahora" compliance={data.today.compliance}>
                Asistieron {formatInt(data.today.attended)} de{' '}
                {formatInt(data.today.obligations)} esperados ·{' '}
                {formatInt(data.today.entries)} entradas ·{' '}
                {formatInt(data.today.inside)} dentro ahora
              </Stat>
              <Stat
                title="Esta semana"
                icon="horarios"
                compliance={data.week.compliance}
              >
                Desde el {formatDay(data.weekStart)}: asistieron{' '}
                {formatInt(data.week.attended)} de{' '}
                {formatInt(data.week.obligations)} esperados ·{' '}
                {formatInt(data.week.entries)} entradas
              </Stat>
            </div>

            <section
              className={`card ${styles.attention}`}
              aria-label="Requiere atención"
            >
              <div className={styles.attentionHead}>
                <h2 className={styles.attentionTitle}>Requiere atención</h2>
                <span
                  className={`${styles.chip} ${
                    data.alerts.device.known && !data.alerts.device.online
                      ? styles.chipDanger
                      : data.alerts.device.online
                        ? styles.chipOk
                        : ''
                  }`}
                >
                  {deviceLabel}
                </span>
                <span
                  className={`${styles.chip} ${data.alerts.alarmOn ? styles.chipDanger : ''}`}
                >
                  {data.alerts.alarmOn ? 'Alarma encendida' : 'Alarma apagada'}
                </span>
              </div>
              <div className={styles.blocks}>
                <div className={styles.block}>
                  <span>Sesiones abiertas en horarios ya terminados</span>
                  <strong className={styles.blockNumber}>
                    {formatInt(data.alerts.staleOpen)}
                  </strong>
                </div>
                <div className={`${styles.block} ${styles.blockWarn}`}>
                  <span>Salidas no registradas (últimos 7 días)</span>
                  <strong className={styles.blockNumber}>
                    {formatInt(data.alerts.unregistered7d)}
                  </strong>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
