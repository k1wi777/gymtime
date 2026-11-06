'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import type { PanelNow, PanelPerson } from '@/api/types';
import { useLiveEvents, useResync } from '@/live/live-provider';
import { pushScan, type ScanEntry } from '@/live/reducers';
import { SCAN_RESULT_LABELS, SOURCE_LABELS, rejectLabel } from '@/lib/labels';
import { formatCountdown, formatTime, formatTimeSeconds } from '@/lib/time';
import { useDebouncedCallback } from '@/lib/use-debounced';
import { useNow } from '@/lib/use-now';
import { useResource } from '@/lib/use-resource';
import { describeError } from '@/api/errors';
import { Badge } from '@/ui/Badge';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import styles from './Ahora.module.css';

/** Pause that groups the burst of events of one scan into a single refetch. */
export const REFETCH_DEBOUNCE_MS = 300;

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className={`card ${styles.counter}`}>
      <div className={styles.number}>{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

function PersonList({
  title,
  people,
  empty,
  detail,
}: {
  title: string;
  people: readonly PanelPerson[];
  empty: string;
  detail: (person: PanelPerson) => React.ReactNode;
}) {
  return (
    <section className="card" aria-label={title}>
      <h2>
        {title} <span className="muted">({people.length})</span>
      </h2>
      {people.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className={styles.list}>
          {people.map((person) => (
            <li key={person.studentId} data-testid="person">
              <div>
                <strong>{person.name}</strong>
                <div className="muted">{person.document}</div>
              </div>
              <div className={styles.detail}>{detail(person)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Seconds left, counted down locally from the server's clock (R15). */
function useRemaining(
  snapshot: PanelNow | undefined,
  offset: number,
): number | null {
  const now = useNow(1000);
  if (!snapshot?.current) return null;
  const serverNow = now + offset;
  return Math.max(0, (Date.parse(snapshot.current.endsAt) - serverNow) / 1000);
}

function ScanFeed({ feed }: { feed: readonly ScanEntry[] }) {
  return (
    <section className="card" aria-label="Últimos escaneos">
      <h2>Últimos escaneos</h2>
      {feed.length === 0 ? (
        <p className="muted">Todavía no se ha escaneado ninguna huella.</p>
      ) : (
        <ul className={styles.list}>
          {feed.map((scan) => (
            <li key={scan.key}>
              <div>
                <strong>{scan.data.studentName ?? 'Sin identificar'}</strong>
                <div className="muted">{formatTimeSeconds(scan.at)}</div>
              </div>
              <div className={styles.detail}>
                <Badge
                  tone={
                    scan.data.result === 'denied' ||
                    scan.data.result === 'unknown'
                      ? 'danger'
                      : scan.data.result === 'entry'
                        ? 'success'
                        : 'info'
                  }
                >
                  {SCAN_RESULT_LABELS[scan.data.result]}
                </Badge>
                {scan.data.result === 'denied' && (
                  <div className="muted">{rejectLabel(scan.data.reason)}</div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Ahora() {
  // The browser clock may be off: the countdown runs against the server's
  // `serverNow`, recalibrated with every snapshot.
  const [clockOffset, setClockOffset] = useState(0);
  const snapshot = useResource(async (signal) => {
    const data = await call(getApi().client.GET('/panel/now', { signal }));
    setClockOffset(Date.parse(data.serverNow) - Date.now());
    return data;
  }, []);
  const [feed, setFeed] = useState<ScanEntry[]>([]);

  // The server decides who is expected and who is missing (assignments,
  // windows): refetch the snapshot instead of editing the lists here.
  const refetch = useDebouncedCallback(snapshot.reload, REFETCH_DEBOUNCE_MS);
  useLiveEvents((event) => {
    if (event.type === 'attendance' || event.type === 'alarm') refetch();
    if (event.type === 'scan') setFeed((current) => pushScan(current, event));
  });
  useResync(snapshot.reload);

  const remaining = useRemaining(snapshot.data, clockOffset);

  if (snapshot.error && !snapshot.data) {
    return (
      <Notice
        kind="error"
        title="No se pudo cargar el estado"
        actions={
          <button type="button" className="btn" onClick={snapshot.reload}>
            Reintentar
          </button>
        }
      >
        {describeError(snapshot.error)}
      </Notice>
    );
  }
  if (!snapshot.data) return <Spinner />;

  const { current, counts, inside, exited, missing } = snapshot.data;
  return (
    <div className="stack">
      <div className={styles.head}>
        <div>
          <h1>Ahora</h1>
          {current ? (
            <p>
              <strong>{current.scheduleName}</strong>{' '}
              <span className="muted">
                {formatTime(current.startsAt)} – {formatTime(current.endsAt)}
              </span>{' '}
              {current.entryOpen ? (
                <Badge tone="success">Ingreso abierto</Badge>
              ) : (
                <Badge tone="warning">Ingreso cerrado</Badge>
              )}
            </p>
          ) : (
            <p className="muted">No hay un horario en curso.</p>
          )}
        </div>
        {current && remaining !== null && (
          <div className={styles.clock} aria-live="off">
            <div className="muted">Tiempo restante</div>
            <div className={styles.countdown} data-testid="countdown">
              {formatCountdown(remaining)}
            </div>
          </div>
        )}
      </div>
      {snapshot.error ? (
        <Notice kind="warning" title="No se pudo actualizar">
          {describeError(snapshot.error)} Se muestra el último estado conocido.
        </Notice>
      ) : null}
      {current && (
        <div className={styles.counters}>
          <Counter label="Esperados" value={counts.expected} />
          <Counter label="Dentro" value={counts.inside} />
          <Counter label="Salieron" value={counts.exited} />
          <Counter label="Faltan" value={counts.missing} />
        </div>
      )}
      <div className="grid-3">
        <PersonList
          title="Dentro"
          people={inside}
          empty={current ? 'Nadie está dentro.' : 'Nadie sigue dentro.'}
          detail={(person) => (
            <>
              {person.enteredAt && (
                <span>Entró {formatTime(person.enteredAt)}</span>
              )}{' '}
              {person.source && (
                <Badge tone="info">{SOURCE_LABELS[person.source]}</Badge>
              )}
            </>
          )}
        />
        {current && (
          <PersonList
            title="Faltan"
            people={missing}
            empty="Todos los esperados ya llegaron."
            detail={(person) =>
              person.hasFingerprint ? null : (
                <Badge tone="warning">Sin huella</Badge>
              )
            }
          />
        )}
        {current && (
          <PersonList
            title="Salieron"
            people={exited}
            empty="Nadie ha salido todavía."
            detail={(person) =>
              person.sessionStatus === 'no_registrada' ? (
                <Badge tone="danger">Salida no registrada</Badge>
              ) : (
                <span>
                  {person.enteredAt && formatTime(person.enteredAt)} –{' '}
                  {person.exitedAt && formatTime(person.exitedAt)}
                </span>
              )
            }
          />
        )}
      </div>
      <ScanFeed feed={feed} />
    </div>
  );
}
