'use client';

import { useEffect, useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { AuditItem } from '@/api/types';
import { formatDateTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { SelectField, TextField } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
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

  return (
    <div className="stack">
      <h1>Auditoría</h1>
      <p className="muted">
        Quién hizo qué y cuándo. No incluye huellas, contraseñas ni datos de
        contacto.
      </p>
      <div className={styles.filters}>
        <TextField
          label="Tipo de evento"
          value={type}
          onChange={setType}
          help="Por ejemplo student.created"
        />
        <SelectField
          label="Usuario"
          value={actorId}
          onChange={setActorId}
          options={[
            { value: '', label: 'Todos' },
            ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name })),
          ]}
        />
        <DateRange from={from} to={to} onFrom={setFrom} onTo={setTo} />
      </div>
      {first.loading && !first.data && <Spinner />}
      {first.error ? (
        <Notice kind="error">{describeError(first.error)}</Notice>
      ) : null}
      {moreFailure && <Notice kind="error">{moreFailure}</Notice>}
      {first.data && (
        <>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption className="visually-hidden">
                Eventos de auditoría
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Evento</th>
                  <th scope="col">Responsable</th>
                  <th scope="col">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.createdAt)}</td>
                    <td>{EVENT_LABELS[item.type] ?? item.type}</td>
                    <td>{actorLabel(item.actor)}</td>
                    <td>
                      <Detail detail={item.detail} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {items.length === 0 && (
            <p className="muted">No hay eventos con esos filtros.</p>
          )}
          {nextBefore !== null && (
            <div>
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
      )}
    </div>
  );
}
