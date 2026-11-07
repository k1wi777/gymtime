'use client';

import { useEffect, useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { AlarmHistoryItem, OrderItem } from '@/api/types';
import { SOURCE_LABELS } from '@/lib/labels';
import { formatDateTime, formatTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { Badge } from '@/ui/Badge';
import { SelectField, TextField } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { ReviewTable } from '@/features/offline/PorRevisar';
import { actorLabel } from './Auditoria';
import { DateRange, dayRange } from './filters';
import styles from './Admin.module.css';

const PAGE = 50;
const TABS = [
  ['asistencia', 'Ingresos y egresos'],
  ['ordenes', 'Alarma y mensajes'],
  ['alarmas', 'Alarmas'],
  ['sinconexion', 'Sin conexión'],
] as const;
type Tab = (typeof TABS)[number][0];

const STATUS_LABELS = {
  abierta: 'Dentro',
  cerrada: 'Cerrada',
  no_registrada: 'Salida no registrada',
} as const;

const ORDER_LABELS: Record<string, string> = {
  'display.message_sent': 'Mensaje en pantalla',
  'alarm.manual_on': 'Alarma encendida',
  'alarm.manual_off': 'Alarma apagada',
  'alarm.button_off': 'Alarma apagada con el botón',
  'sync.triggered': 'Sincronización',
};

const CLOSED_BY_LABELS = {
  all_exited: 'Salieron todos',
  button: 'Botón del lector',
  cli: 'Apagada a mano',
  timeout: 'Tiempo máximo',
} as const;

function Pager({
  offset,
  total,
  onOffset,
}: {
  offset: number;
  total: number;
  onOffset: (value: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.floor(offset / PAGE) + 1;
  if (pages <= 1) return null;
  return (
    <nav className="row" aria-label="Paginación">
      <button
        type="button"
        className="btn"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(0, offset - PAGE))}
      >
        Anterior
      </button>
      <span>
        Página {page} de {pages}
      </span>
      <button
        type="button"
        className="btn"
        disabled={page >= pages}
        onClick={() => onOffset(offset + PAGE)}
      >
        Siguiente
      </button>
    </nav>
  );
}

function Attendance() {
  const schedules = useResource(
    (signal) => call(getApi().client.GET('/schedules', { signal })),
    [],
  );
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [source, setSource] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const history = useResource(
    (signal) =>
      call(
        getApi().client.GET('/panel/attendance/history', {
          params: {
            query: {
              limit: PAGE,
              offset,
              ...dayRange(from, to),
              ...(scheduleId ? { scheduleId } : {}),
              ...(source
                ? { source: source as 'device' | 'manual' | 'offline' }
                : {}),
              ...(status
                ? { status: status as keyof typeof STATUS_LABELS }
                : {}),
              ...(debounced ? { search: debounced } : {}),
            },
          },
          signal,
        }),
      ),
    [from, to, scheduleId, source, status, debounced, offset],
  );
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOffset(0);
    };

  return (
    <div className="stack">
      <div className={styles.filters}>
        <DateRange
          from={from}
          to={to}
          onFrom={reset(setFrom)}
          onTo={reset(setTo)}
        />
        <SelectField
          label="Horario"
          value={scheduleId}
          onChange={reset(setScheduleId)}
          options={[
            { value: '', label: 'Todos' },
            ...(schedules.data ?? []).map((s) => ({
              value: s.id,
              label: s.name,
            })),
          ]}
        />
        <SelectField
          label="Origen"
          value={source}
          onChange={reset(setSource)}
          options={[
            { value: '', label: 'Todos' },
            { value: 'device', label: SOURCE_LABELS.device },
            { value: 'manual', label: SOURCE_LABELS.manual },
            { value: 'offline', label: SOURCE_LABELS.offline },
          ]}
        />
        <SelectField
          label="Estado"
          value={status}
          onChange={reset(setStatus)}
          options={[
            { value: '', label: 'Todos' },
            ...Object.entries(STATUS_LABELS).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <TextField
          label="Estudiante"
          type="search"
          value={search}
          onChange={setSearch}
          help="Nombre o documento"
        />
      </div>
      {history.loading && !history.data && <Spinner />}
      {history.error ? (
        <Notice kind="error">{describeError(history.error)}</Notice>
      ) : null}
      {history.data && (
        <>
          <p className="muted">{history.data.total} registro(s)</p>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption className="visually-hidden">
                Historial de ingresos y egresos
              </caption>
              <thead>
                <tr>
                  <th scope="col">Sesión</th>
                  <th scope="col">Estudiante</th>
                  <th scope="col">Entrada</th>
                  <th scope="col">Salida</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Motivo y responsable</th>
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.schedule.name}
                      <br />
                      <span className="muted">
                        {formatDateTime(row.startsAt)}
                      </span>
                    </td>
                    <td>
                      {row.student.name}
                      <br />
                      <span className="muted">{row.student.document}</span>
                    </td>
                    <td>
                      {formatTime(row.enteredAt)}{' '}
                      <Badge
                        tone={
                          row.entrySource === 'manual'
                            ? 'warning'
                            : row.entrySource === 'offline'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {SOURCE_LABELS[row.entrySource]}
                      </Badge>
                    </td>
                    <td>
                      {row.exitedAt ? formatTime(row.exitedAt) : '—'}{' '}
                      {row.exitSource && (
                        <Badge
                          tone={
                            row.exitSource === 'manual'
                              ? 'warning'
                              : row.exitSource === 'offline'
                                ? 'info'
                                : 'neutral'
                          }
                        >
                          {SOURCE_LABELS[row.exitSource]}
                        </Badge>
                      )}
                    </td>
                    <td>{STATUS_LABELS[row.status]}</td>
                    <td>
                      {row.manualReason ? (
                        <>
                          {row.manualReason}
                          <br />
                          <span className="muted">
                            {[row.entryBy, row.exitBy]
                              .filter((a) => a !== null)
                              .map(actorLabel)
                              .join(' / ')}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.data.items.length === 0 && (
            <p className="muted">No hay registros con esos filtros.</p>
          )}
          <Pager
            offset={offset}
            total={history.data.total}
            onOffset={setOffset}
          />
        </>
      )}
    </div>
  );
}

function Orders() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paged, setPaged] = useState<{
    key: string;
    items: OrderItem[];
    next: number | null;
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const range = dayRange(from, to);
  const key = JSON.stringify(range);
  const first = useResource(
    (signal) =>
      call(
        getApi().client.GET('/history/orders', {
          params: { query: { limit: PAGE, ...range } },
          signal,
        }),
      ),
    [key],
  );
  const current = paged?.key === key ? paged : null;
  const next = current ? current.next : (first.data?.nextBefore ?? null);
  const items = [...(first.data?.items ?? []), ...(current?.items ?? [])];

  const more = async () => {
    if (next === null) return;
    setFailure(null);
    try {
      const page = await call(
        getApi().client.GET('/history/orders', {
          params: { query: { limit: PAGE, before: next, ...range } },
        }),
      );
      setPaged({
        key,
        items: [...(current?.items ?? []), ...page.items],
        next: page.nextBefore,
      });
    } catch (error) {
      setFailure(describeError(error));
    }
  };

  return (
    <div className="stack">
      <div className={styles.filters}>
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>
      {first.loading && !first.data && <Spinner />}
      {first.error ? (
        <Notice kind="error">{describeError(first.error)}</Notice>
      ) : null}
      {failure && <Notice kind="error">{failure}</Notice>}
      {first.data && (
        <>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption className="visually-hidden">
                Órdenes enviadas al lector
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Orden</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>
                      {ORDER_LABELS[item.type] ?? item.type}
                      {item.text && (
                        <>
                          <br />
                          <span className="muted">{item.text}</span>
                        </>
                      )}
                    </td>
                    <td>{actorLabel(item.actor)}</td>
                    <td>
                      {item.status ?? '—'}
                      {item.sessionsClosed !== null &&
                        ` · ${item.sessionsClosed} sesiones cerradas`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length === 0 && (
            <p className="muted">No hay órdenes en ese rango.</p>
          )}
          {next !== null && (
            <div>
              <button type="button" className="btn" onClick={() => void more()}>
                Cargar más antiguas
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Alarms() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const alarms = useResource(
    (signal) =>
      call(
        getApi().client.GET('/history/alarms', {
          params: { query: { limit: PAGE, offset, ...dayRange(from, to) } },
          signal,
        }),
      ),
    [from, to, offset],
  );
  return (
    <div className="stack">
      <div className={styles.filters}>
        <DateRange
          from={from}
          to={to}
          onFrom={(v) => {
            setFrom(v);
            setOffset(0);
          }}
          onTo={(v) => {
            setTo(v);
            setOffset(0);
          }}
        />
      </div>
      {alarms.loading && !alarms.data && <Spinner />}
      {alarms.error ? (
        <Notice kind="error">{describeError(alarms.error)}</Notice>
      ) : null}
      {alarms.data && (
        <>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption className="visually-hidden">
                Historial de alarmas
              </caption>
              <thead>
                <tr>
                  <th scope="col">Inicio</th>
                  <th scope="col">Horario</th>
                  <th scope="col">Fin</th>
                  <th scope="col">Cierre</th>
                  <th scope="col">Sesiones cerradas</th>
                </tr>
              </thead>
              <tbody>
                {alarms.data.items.map((a: AlarmHistoryItem) => (
                  <tr key={a.id}>
                    <td>{formatDateTime(a.startedAt)}</td>
                    <td>
                      {a.schedule?.name ?? '—'}
                      {a.origin === 'local' && (
                        <>
                          <br />
                          <Badge tone="info">Local (sin conexión)</Badge>
                        </>
                      )}
                    </td>
                    <td>
                      {a.endedAt ? formatDateTime(a.endedAt) : 'Sigue activa'}
                    </td>
                    <td>
                      {a.closedBy ? CLOSED_BY_LABELS[a.closedBy] : '—'}
                      {a.closedByActor && (
                        <>
                          <br />
                          <span className="muted">
                            {actorLabel(a.closedByActor)}
                          </span>
                        </>
                      )}
                    </td>
                    <td>{a.closedSessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {alarms.data.items.length === 0 && (
            <p className="muted">No hay alarmas en ese rango.</p>
          )}
          <Pager
            offset={offset}
            total={alarms.data.total}
            onOffset={setOffset}
          />
        </>
      )}
    </div>
  );
}

const REVIEW_VIEWS = [
  { value: 'pending', label: 'Por revisar' },
  { value: 'discarded', label: 'Descartados' },
  { value: 'resolved', label: 'Aprobados y corregidos' },
] as const;

/** Events recorded without connection, apart from the sessions (they are not sessions). */
function OfflineEvents() {
  const [view, setView] = useState<'pending' | 'discarded' | 'resolved'>(
    'pending',
  );
  const [offset, setOffset] = useState(0);
  const events = useResource(
    (signal) =>
      call(
        getApi().client.GET('/offline/review', {
          params: { query: { view, limit: PAGE, offset } },
          signal,
        }),
      ),
    [view, offset],
  );
  return (
    <div className="stack">
      <div className={styles.filters}>
        <SelectField
          label="Estado"
          value={view}
          onChange={(value) => {
            setView(value as typeof view);
            setOffset(0);
          }}
          options={REVIEW_VIEWS}
        />
      </div>
      {events.loading && !events.data && <Spinner />}
      {events.error ? (
        <Notice kind="error">{describeError(events.error)}</Notice>
      ) : null}
      {events.data && (
        <>
          <p className="muted">{events.data.total} registro(s)</p>
          {events.data.items.length === 0 ? (
            <p className="muted">No hay registros en este estado.</p>
          ) : (
            <ReviewTable items={events.data.items} />
          )}
          <Pager
            offset={offset}
            total={events.data.total}
            onOffset={setOffset}
          />
        </>
      )}
    </div>
  );
}

export function Historial() {
  const [tab, setTab] = useState<Tab>('asistencia');
  return (
    <div className="stack">
      <h1>Historial</h1>
      <div className="row" role="tablist" aria-label="Tipo de historial">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`btn ${tab === id ? 'btn-primary' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'asistencia' && <Attendance />}
        {tab === 'ordenes' && <Orders />}
        {tab === 'alarmas' && <Alarms />}
        {tab === 'sinconexion' && <OfflineEvents />}
      </div>
    </div>
  );
}
