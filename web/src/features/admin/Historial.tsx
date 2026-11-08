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
import { PageHeader } from '@/ui/PageHeader';
import { Spinner } from '@/ui/Spinner';
import { ReviewTable } from '@/features/offline/PorRevisar';
import { actorLabel } from './Auditoria';
import { BoardCard } from './BoardCard';
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
    <nav className={styles.pager} aria-label="Paginación">
      <button
        type="button"
        className="btn btn-s"
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
        className="btn btn-s"
        disabled={page >= pages}
        onClick={() => onOffset(offset + PAGE)}
      >
        Siguiente
      </button>
    </nav>
  );
}

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/** Origin tag: color only for «Manual»; the other origins stay neutral. */
function Origin({ source }: { source: keyof typeof SOURCE_LABELS }) {
  return (
    <Badge tone={source === 'manual' ? 'warning' : 'neutral'} size="sm">
      {SOURCE_LABELS[source]}
    </Badge>
  );
}

const STATUS_TONES = {
  abierta: 'success',
  cerrada: 'soft',
  no_registrada: 'warning',
} as const;

/** Reports its total to the page header (the line under the title). */
function useReportTotal(
  total: number | undefined,
  onTotal: (total: number | null) => void,
) {
  useEffect(() => {
    onTotal(total ?? null);
  }, [total, onTotal]);
}

function Attendance({ onTotal }: { onTotal: (total: number | null) => void }) {
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
  useReportTotal(history.data?.total, onTotal);
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setOffset(0);
    };

  return (
    <>
      <section className={`card ${styles.filterCard}`} aria-label="Filtros">
        <DateRange
          from={from}
          to={to}
          onFrom={reset(setFrom)}
          onTo={reset(setTo)}
        />
        <div className={styles.grow160}>
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
        </div>
        <div className={styles.dateField}>
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
        </div>
        <div className={styles.dateField}>
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
        </div>
        <div className={styles.grow200}>
          <TextField
            label="Estudiante"
            type="search"
            value={search}
            onChange={setSearch}
            help="Nombre o documento"
          />
        </div>
      </section>
      {history.loading && !history.data && <Spinner />}
      {history.error ? (
        <Notice kind="error">{describeError(history.error)}</Notice>
      ) : null}
      {history.data && (
        <BoardCard
          label="Registros"
          minWidth={940}
          footer={
            <>
              {history.data.items.length === 0 && (
                <p className={`muted ${styles.empty}`}>
                  No hay registros con esos filtros.
                </p>
              )}
              <Pager
                offset={offset}
                total={history.data.total}
                onOffset={setOffset}
              />
            </>
          }
        >
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
                  <div className={styles.strong}>{row.schedule.name}</div>
                  <div className={styles.sub}>
                    {formatDateTime(row.startsAt)}
                  </div>
                </td>
                <td>
                  <div className={styles.strong}>{row.student.name}</div>
                  <div className={styles.sub}>{row.student.document}</div>
                </td>
                <td className={styles.nowrap}>
                  <span className={styles.strong}>
                    {formatTime(row.enteredAt)}
                  </span>{' '}
                  <Origin source={row.entrySource} />
                </td>
                <td className={styles.nowrap}>
                  <span className={styles.strong}>
                    {row.exitedAt ? formatTime(row.exitedAt) : '—'}
                  </span>{' '}
                  {row.exitSource && <Origin source={row.exitSource} />}
                </td>
                <td>
                  <Badge tone={STATUS_TONES[row.status]}>
                    {STATUS_LABELS[row.status]}
                  </Badge>
                </td>
                <td className={styles.reasonCell}>
                  {row.manualReason ? (
                    <>
                      {row.manualReason}
                      <div className={styles.sub}>
                        {[row.entryBy, row.exitBy]
                          .filter((a) => a !== null)
                          .map(actorLabel)
                          .join(' / ')}
                      </div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </BoardCard>
      )}
    </>
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
    <>
      <section className={`card ${styles.filterCard}`} aria-label="Filtros">
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </section>
      {first.loading && !first.data && <Spinner />}
      {first.error ? (
        <Notice kind="error">{describeError(first.error)}</Notice>
      ) : null}
      {failure && <Notice kind="error">{failure}</Notice>}
      {first.data && (
        <BoardCard
          label="Órdenes"
          minWidth={720}
          footer={
            <>
              {items.length === 0 && (
                <p className={`muted ${styles.empty}`}>
                  No hay órdenes en ese rango.
                </p>
              )}
              {next !== null && (
                <div className={styles.more}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void more()}
                  >
                    Cargar más antiguas
                  </button>
                </div>
              )}
            </>
          }
        >
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
                <td className={styles.nowrap}>
                  {formatDateTime(item.createdAt)}
                </td>
                <td>
                  <span className={styles.strong}>
                    {ORDER_LABELS[item.type] ?? item.type}
                  </span>
                  {item.text && <div className={styles.sub}>{item.text}</div>}
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
        </BoardCard>
      )}
    </>
  );
}

function Alarms({ onTotal }: { onTotal: (total: number | null) => void }) {
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
  useReportTotal(alarms.data?.total, onTotal);
  return (
    <>
      <section className={`card ${styles.filterCard}`} aria-label="Filtros">
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
      </section>
      {alarms.loading && !alarms.data && <Spinner />}
      {alarms.error ? (
        <Notice kind="error">{describeError(alarms.error)}</Notice>
      ) : null}
      {alarms.data && (
        <BoardCard
          label="Alarmas"
          minWidth={720}
          footer={
            <>
              {alarms.data.items.length === 0 && (
                <p className={`muted ${styles.empty}`}>
                  No hay alarmas en ese rango.
                </p>
              )}
              <Pager
                offset={offset}
                total={alarms.data.total}
                onOffset={setOffset}
              />
            </>
          }
        >
          <caption className="visually-hidden">Historial de alarmas</caption>
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
                <td className={styles.nowrap}>{formatDateTime(a.startedAt)}</td>
                <td>
                  <span className={styles.strong}>
                    {a.schedule?.name ?? '—'}
                  </span>
                  {a.origin === 'local' && (
                    <div>
                      <Badge tone="info" size="sm">
                        Local (sin conexión)
                      </Badge>
                    </div>
                  )}
                </td>
                <td className={styles.nowrap}>
                  {a.endedAt ? formatDateTime(a.endedAt) : 'Sigue activa'}
                </td>
                <td>
                  {a.closedBy ? CLOSED_BY_LABELS[a.closedBy] : '—'}
                  {a.closedByActor && (
                    <div className={styles.sub}>
                      {actorLabel(a.closedByActor)}
                    </div>
                  )}
                </td>
                <td>{a.closedSessions}</td>
              </tr>
            ))}
          </tbody>
        </BoardCard>
      )}
    </>
  );
}

const REVIEW_VIEWS = [
  { value: 'pending', label: 'Por revisar' },
  { value: 'discarded', label: 'Descartados' },
  { value: 'resolved', label: 'Aprobados y corregidos' },
] as const;

/** Events recorded without connection, apart from the sessions (they are not sessions). */
function OfflineEvents({
  onTotal,
}: {
  onTotal: (total: number | null) => void;
}) {
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
  useReportTotal(events.data?.total, onTotal);
  return (
    <>
      <section className={`card ${styles.filterCard}`} aria-label="Filtros">
        <div className={styles.grow200}>
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
      </section>
      {events.loading && !events.data && <Spinner />}
      {events.error ? (
        <Notice kind="error">{describeError(events.error)}</Notice>
      ) : null}
      {events.data && (
        <section
          className={`card ${styles.tableCard}`}
          aria-label="Registros sin conexión"
        >
          {events.data.items.length === 0 ? (
            <p className={`muted ${styles.emptyOnly}`}>
              No hay registros en este estado.
            </p>
          ) : (
            <ReviewTable items={events.data.items} />
          )}
          <Pager
            offset={offset}
            total={events.data.total}
            onOffset={setOffset}
          />
        </section>
      )}
    </>
  );
}

export function Historial() {
  const [tab, setTab] = useState<Tab>('asistencia');
  const [total, setTotal] = useState<number | null>(null);
  const pick = (id: Tab) => {
    setTotal(null);
    setTab(id);
  };
  return (
    <div>
      <PageHeader
        crumb="Historial"
        title="Historial"
        {...(total !== null
          ? { lead: plural(total, 'registro', 'registros') }
          : {})}
      />
      <div className={styles.main}>
        <div
          className={styles.pills}
          role="tablist"
          aria-label="Tipo de historial"
        >
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={styles.pill}
              onClick={() => pick(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.panel}>
          {tab === 'asistencia' && <Attendance onTotal={setTotal} />}
          {tab === 'ordenes' && <Orders />}
          {tab === 'alarmas' && <Alarms onTotal={setTotal} />}
          {tab === 'sinconexion' && <OfflineEvents onTotal={setTotal} />}
        </div>
      </div>
    </div>
  );
}
