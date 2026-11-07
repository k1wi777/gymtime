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
import { bogotaDay, formatDateTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { REASON_MAX } from '@/lib/validators';
import { Badge } from '@/ui/Badge';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SelectField, TextAreaField, TextField } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import styles from '@/features/admin/Admin.module.css';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Bogota instant of `HH:mm` on the day of the event. */
export const correctedInstant = (item: ReviewItem, time: string): string =>
  `${bogotaDay(item.ts)}T${time}:00-05:00`;

/** Table of events recorded without connection; read-only without `onResolve`. */
export function ReviewTable({
  items,
  onResolve,
}: {
  items: readonly ReviewItem[];
  onResolve?: (item: ReviewItem) => void;
}) {
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
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
            {onResolve && <th scope="col">Acción</th>}
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
              {onResolve && (
                <td>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onResolve(item)}
                    aria-label={`Resolver ${REVIEW_TYPE_LABELS[item.type] ?? item.type} de ${item.student?.name ?? 'huella desconocida'}`}
                  >
                    Resolver
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

export function PorRevisar() {
  const list = useResource(
    (signal) =>
      call(
        getApi().client.GET('/offline/review', {
          params: { query: { view: 'pending', limit: 100 } },
          signal,
        }),
      ),
    [],
  );
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useLiveEvents((event) => {
    if (event.type === 'offline.review') list.reload();
  });
  useResync(list.reload);

  return (
    <div className="stack">
      <h1>Por revisar</h1>
      <p className="muted">
        Registros que el lector guardó sin conexión y que no encajan con lo que
        ya hay en el sistema. Decida cada uno: aprobarlo, corregir la hora o
        descartarlo. Queda anotado quién lo resolvió y por qué.
      </p>
      {success && (
        <Notice kind="success" onDismiss={() => setSuccess(null)}>
          {success}
        </Notice>
      )}
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
          <Notice kind="info">No hay registros por revisar.</Notice>
        ) : (
          <>
            <p className="muted">{list.data.total} por revisar</p>
            <ReviewTable items={list.data.items} onResolve={setSelected} />
          </>
        ))}
      <ResolveDialog
        item={selected}
        onClose={() => setSelected(null)}
        onDone={(message) => {
          setSelected(null);
          setSuccess(message);
          list.reload();
        }}
      />
    </div>
  );
}
