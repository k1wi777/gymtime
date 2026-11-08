'use client';

import { Fragment, useEffect, useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { AuditItem } from '@/api/types';
import { formatDate, formatTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { SelectField, TextField } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { Spinner } from '@/ui/Spinner';
import { auditDot, withDayHeaders } from './audit-days';
import { BoardCard } from './BoardCard';
import { DateRange, Detail, dayRange } from './filters';
import styles from './Admin.module.css';

/** Friendly names for events whose code is not self-explanatory. */
const EVENT_LABELS: Record<string, string> = {
  'report.exported': 'Exportación de reporte (CSV)',
};
const PAGE = 50;

export const actorLabel = (actor: AuditItem['actor']): string => {
  if (actor.type === 'system') return 'Sistema';
  if (actor.type === 'device') return `Lector ${actor.id ?? ''}`.trim();
  return actor.name ?? `Usuario ${actor.id ?? ''}`.trim();
};

export function Auditoria() {
  const users = useResource(
    (signal) => call(getApi().client.GET('/users', { signal })),
    [],
  );
  const [type, setType] = useState('');
  const [debouncedType, setDebouncedType] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paged, setPaged] = useState<{
    key: string;
    items: AuditItem[];
    next: number | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailure, setMoreFailure] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedType(type.trim()), 300);
    return () => clearTimeout(timer);
  }, [type]);

  const query = {
    limit: PAGE,
    ...(debouncedType ? { type: debouncedType } : {}),
    ...(actorId ? { actorId } : {}),
    ...dayRange(from, to),
  };
  const key = JSON.stringify(query);
  const first = useResource(
    (signal) =>
      call(getApi().client.GET('/audit', { params: { query }, signal })),
    [key],
  );

  // Older pages belong to the filter they were loaded with.
  const current = paged?.key === key ? paged : null;
  const nextBefore = current ? current.next : (first.data?.nextBefore ?? null);
  const items = [...(first.data?.items ?? []), ...(current?.items ?? [])];

  const loadMore = async () => {
    if (nextBefore === null) return;
    setLoadingMore(true);
    setMoreFailure(null);
    try {
      const page = await call(
        getApi().client.GET('/audit', {
          params: { query: { ...query, before: nextBefore } },
        }),
      );
      setPaged({
        key,
        items: [...(current?.items ?? []), ...page.items],
        next: page.nextBefore,
      });
    } catch (error) {
      setMoreFailure(describeError(error));
    } finally {
      setLoadingMore(false);
    }
  };

  const rows = withDayHeaders(items, (item) => formatDate(item.createdAt));

  return (
    <div>
      <PageHeader
        crumb="Auditoría"
        title="Auditoría"
        lead="Quién hizo qué y cuándo. No incluye huellas, contraseñas ni datos de contacto."
      />
      <div className={styles.main}>
        <section className={`card ${styles.filterCard}`} aria-label="Filtros">
          <div className={styles.grow2}>
            <TextField
              label="Tipo de evento"
              value={type}
              onChange={setType}
              help="Por ejemplo student.created"
            />
          </div>
          <div className={styles.grow200}>
            <SelectField
              label="Usuario"
              value={actorId}
              onChange={setActorId}
              options={[
                { value: '', label: 'Todos' },
                ...(users.data ?? []).map((u) => ({
                  value: u.id,
                  label: u.name,
                })),
              ]}
            />
          </div>
          <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
        </section>
        {first.loading && !first.data && <Spinner />}
        {first.error ? (
          <Notice kind="error">{describeError(first.error)}</Notice>
        ) : null}
        {moreFailure && <Notice kind="error">{moreFailure}</Notice>}
        {first.data && (
          <BoardCard
            label="Eventos de auditoría"
            minWidth={900}
            footer={
              <>
                {items.length === 0 && (
                  <p className={`muted ${styles.empty}`}>
                    No hay eventos con esos filtros.
                  </p>
                )}
                {nextBefore !== null && (
                  <div className={styles.more}>
                    <button
                      type="button"
                      className="btn"
                      disabled={loadingMore}
                      onClick={() => void loadMore()}
                    >
                      {loadingMore ? 'Un momento…' : 'Cargar más antiguos'}
                    </button>
                  </div>
                )}
              </>
            }
          >
            <caption className="visually-hidden">Eventos de auditoría</caption>
            <thead>
              <tr>
                <th scope="col">Hora</th>
                <th scope="col">Evento</th>
                <th scope="col">Responsable</th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody className={styles.top}>
              {rows.map(({ item, day }) => (
                <Fragment key={item.id}>
                  {day !== null && (
                    <tr>
                      <th
                        colSpan={4}
                        scope="colgroup"
                        className={styles.dayRow}
                      >
                        {day}
                      </th>
                    </tr>
                  )}
                  <tr>
                    <td className={`${styles.nowrap} ${styles.time}`}>
                      {formatTime(item.createdAt)}
                    </td>
                    <td className={styles.nowrap}>
                      <span className={styles.eventPill}>
                        <span
                          aria-hidden="true"
                          className={styles.eventDot}
                          style={{ background: auditDot(item.type) }}
                        />
                        {EVENT_LABELS[item.type] ?? item.type}
                      </span>
                    </td>
                    <td className={`${styles.nowrap} ${styles.strong}`}>
                      {actorLabel(item.actor)}
                    </td>
                    <td>
                      <Detail detail={item.detail} />
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </BoardCard>
        )}
      </div>
    </div>
  );
}
