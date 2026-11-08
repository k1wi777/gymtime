'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { ReviewItem } from '@/api/types';
import { useLiveEvents, useResync } from '@/live/live-provider';
import {
  REVIEW_ACTION_LABELS,
  REVIEW_OUTCOME_LABELS,
  REVIEW_TYPE_LABELS,
  reviewReasonLabel,
} from '@/lib/labels';
import { bogotaDay, formatDate, formatDateTime, formatTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { REASON_MAX } from '@/lib/validators';
import { Avatar } from '@/ui/Avatar';
import { Badge } from '@/ui/Badge';
import { Icon } from '@/ui/icons';
import { PageHeader } from '@/ui/PageHeader';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SelectField, TextAreaField, TextField } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import adminStyles from '@/features/admin/Admin.module.css';
import styles from './PorRevisar.module.css';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Bogota instant of `HH:mm` on the day of the event. */
export const correctedInstant = (item: ReviewItem, time: string): string =>
  `${bogotaDay(item.ts)}T${time}:00-05:00`;

/** Read-only table of events recorded without connection (admin history). */
export function ReviewTable({ items }: { items: readonly ReviewItem[] }) {
  return (
    <div className={adminStyles.scroll}>
      <table className={adminStyles.table}>
        <caption className="visually-hidden">
          Eventos registrados sin conexión
        </caption>
        <thead>
          <tr>
            <th scope="col">Hora del lector</th>
            <th scope="col">Estudiante</th>
            <th scope="col">Evento</th>
            <th scope="col">Motivo</th>
            <th scope="col">Estado</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{formatDateTime(item.ts)}</td>
              <td>
                {item.student ? (
                  <>
                    {item.student.name}
                    <br />
                    <span className="muted">{item.student.document}</span>
                  </>
                ) : (
                  '—'
                )}
                {item.schedule && (
                  <>
                    <br />
                    <span className="muted">{item.schedule.name}</span>
                  </>
                )}
              </td>
              <td>{REVIEW_TYPE_LABELS[item.type] ?? item.type}</td>
              <td>{reviewReasonLabel(item.reviewReason)}</td>
              <td>
                <Badge
                  tone={item.outcome === 'por_revisar' ? 'warning' : 'neutral'}
                >
                  {REVIEW_OUTCOME_LABELS[item.outcome] ?? item.outcome}
                </Badge>
                {item.resolutionNote && (
                  <>
                    <br />
                    <span className="muted">{item.resolutionNote}</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STAMP_CLASS: Record<string, string> = {
  entry: styles.stampEntry ?? '',
  exit: styles.stampExit ?? '',
};

/** Pending events as cards, one per event, with the way to resolve each. */
function ReviewCards({
  items,
  onResolve,
}: {
  items: readonly ReviewItem[];
  onResolve: (item: ReviewItem) => void;
}) {
  return (
    <ul className={styles.list}>
      {items.map((item) => {
        const type = REVIEW_TYPE_LABELS[item.type] ?? item.type;
        return (
          <li key={item.id} className={`card ${styles.item}`}>
            <div
              className={`${styles.stamp} ${STAMP_CLASS[item.type] ?? styles.stampOther}`}
            >
              <div className={styles.stampType}>{type}</div>
              <div className={styles.stampTime}>{formatTime(item.ts)}</div>
              <div className={styles.stampDate}>{formatDate(item.ts)}</div>
            </div>
            <div className={styles.main}>
              <div className={styles.who}>
                {item.student && (
                  <Avatar name={item.student.name} id={item.student.id} />
                )}
                <div>
                  <div className={styles.name}>
                    {item.student?.name ?? 'Huella desconocida'}
                  </div>
                  <div className={styles.sub}>
                    {item.student?.document}
                    {item.student && item.schedule ? ' · ' : ''}
                    {item.schedule?.name}
                  </div>
                  <div className={styles.sub}>
                    Registrado por el lector sin conexión
                  </div>
                </div>
              </div>
              <div className={styles.reason}>
                <Icon
                  name="alertaTriangulo"
                  size={18}
                  strokeWidth={2}
                  className={styles.reasonIcon}
                />
                <span>
                  <strong>Por qué está aquí:</strong>{' '}
                  {reviewReasonLabel(item.reviewReason)}
                </span>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => onResolve(item)}
                  aria-label={`Resolver ${type} de ${item.student?.name ?? 'huella desconocida'}`}
                >
                  Resolver
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ResolveDialog({
  item,
  onClose,
  onDone,
}: {
  item: ReviewItem | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [time, setTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [shown, setShown] = useState<ReviewItem | null>(null);
  // A different event starts with a clean form.
  if (item !== shown) {
    setShown(item);
    setAction(item?.actions[0] ?? '');
    setReason('');
    setTime('');
    setFailure(null);
  }

  const needsTime = action === 'corregir';
  const timeError =
    needsTime && time !== '' && !TIME.test(time)
      ? 'Use el formato HH:mm.'
      : undefined;
  const ready =
    action !== '' &&
    reason.trim() !== '' &&
    (!needsTime || TIME.test(time)) &&
    !busy;

  const send = async () => {
    if (!item || !ready) return;
    setBusy(true);
    setFailure(null);
    try {
      await call(
        getApi().client.POST('/offline/review/{id}/resolve', {
          params: { path: { id: item.id } },
          body: {
            action: action as 'aprobar' | 'corregir' | 'descartar',
            reason: reason.trim(),
            ...(needsTime ? { ts: correctedInstant(item, time) } : {}),
          },
        }),
      );
      onDone(`${REVIEW_ACTION_LABELS[action] ?? action}: registrado.`);
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={item !== null}
      title="Resolver evento sin conexión"
      confirmLabel="Resolver"
      busy={busy}
      confirmDisabled={!ready}
      onConfirm={() => void send()}
      onCancel={onClose}
    >
      {item && (
        <div className="stack">
          <p>
            <strong>{item.student?.name ?? 'Huella desconocida'}</strong>
            {' · '}
            {REVIEW_TYPE_LABELS[item.type] ?? item.type} a las{' '}
            {formatDateTime(item.ts)}
          </p>
          <p className="muted">{reviewReasonLabel(item.reviewReason)}</p>
          {failure && <Notice kind="error">{failure}</Notice>}
          <SelectField
            label="Acción"
            value={action}
            onChange={setAction}
            options={item.actions.map((value) => ({
              value,
              label: REVIEW_ACTION_LABELS[value] ?? value,
            }))}
          />
          {needsTime && (
            <TextField
              label="Hora correcta"
              value={time}
              onChange={setTime}
              help="HH:mm, del mismo día del evento"
              error={timeError}
              maxLength={5}
            />
          )}
          <TextAreaField
            label="Motivo de la decisión"
            help="Obligatorio. Queda en la auditoría con su usuario."
            maxLength={REASON_MAX}
            value={reason}
            onChange={setReason}
          />
        </div>
      )}
    </ConfirmDialog>
  );
}

type View = 'pending' | 'resolved' | 'discarded';

const VIEWS: { view: View; label: string }[] = [
  { view: 'pending', label: 'Pendientes' },
  { view: 'resolved', label: 'Aprobados' },
  { view: 'discarded', label: 'Descartados' },
];

const EMPTY_TEXT: Record<View, string> = {
  pending: 'No hay registros por revisar.',
  resolved: 'No hay registros aprobados.',
  discarded: 'No hay registros descartados.',
};

const loadView = (view: View, limit: number, signal: AbortSignal) =>
  call(
    getApi().client.GET('/offline/review', {
      params: { query: { view, limit } },
      signal,
    }),
  );

export function PorRevisar() {
  const [view, setView] = useState<View>('pending');
  const list = useResource((signal) => loadView(view, 100, signal), [view]);
  const resolved = useResource((signal) => loadView('resolved', 1, signal), []);
  const discarded = useResource(
    (signal) => loadView('discarded', 1, signal),
    [],
  );
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const reloadAll = () => {
    list.reload();
    resolved.reload();
    discarded.reload();
  };
  useLiveEvents((event) => {
    if (event.type === 'offline.review') reloadAll();
  });
  useResync(reloadAll);

  const counts: Record<View, number | undefined> = {
    pending: view === 'pending' ? list.data?.total : undefined,
    resolved: view === 'resolved' ? list.data?.total : resolved.data?.total,
    discarded: view === 'discarded' ? list.data?.total : discarded.data?.total,
  };

  return (
    <>
      <PageHeader
        eyebrow="Asistente · Modo sin conexión"
        title="Por revisar"
        lead="Registros que el lector guardó sin conexión y que no encajan con lo que ya hay en el sistema. Decida cada uno: aprobarlo, corregir la hora o descartarlo. Queda anotado quién lo resolvió y por qué."
      />
      <div className={styles.body}>
        {success && (
          <Notice kind="success" onDismiss={() => setSuccess(null)}>
            {success}
          </Notice>
        )}
        <div className={styles.tabs} role="tablist" aria-label="Estado">
          {VIEWS.map((entry) => {
            const count = counts[entry.view];
            return (
              <button
                key={entry.view}
                type="button"
                role="tab"
                aria-selected={view === entry.view}
                className={`${styles.tab} ${view === entry.view ? styles.tabActive : ''}`}
                onClick={() => setView(entry.view)}
              >
                {entry.label}
                {count !== undefined && (
                  <span className={styles.tabCount}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
        {list.loading && !list.data && <Spinner />}
        {list.error ? (
          <Notice
            kind="error"
            title="No se pudo cargar la lista"
            actions={
              <button type="button" className="btn" onClick={list.reload}>
                Reintentar
              </button>
            }
          >
            {describeError(list.error)}
          </Notice>
        ) : null}
        {list.data &&
          (list.data.items.length === 0 ? (
            <Notice kind="info">{EMPTY_TEXT[view]}</Notice>
          ) : view === 'pending' ? (
            <ReviewCards items={list.data.items} onResolve={setSelected} />
          ) : (
            <div className="card">
              <ReviewTable items={list.data.items} />
            </div>
          ))}
      </div>
      <ResolveDialog
        item={selected}
        onClose={() => setSelected(null)}
        onDone={(message) => {
          setSelected(null);
          setSuccess(message);
          reloadAll();
        }}
      />
    </>
  );
}
