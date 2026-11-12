'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { call, getApi } from '@/api/client';
import type { PanelNow, PanelPerson } from '@/api/types';
import { useLiveEvents, useResync } from '@/live/live-provider';
import { pushScan, type ScanEntry } from '@/live/reducers';
import { SCAN_RESULT_LABELS, SOURCE_LABELS, rejectLabel } from '@/lib/labels';
import {
  formatCountdown,
  formatLongDay,
  formatTime,
  formatTimeSeconds,
} from '@/lib/time';
import { useDebouncedCallback } from '@/lib/use-debounced';
import { useNow } from '@/lib/use-now';
import { useResource } from '@/lib/use-resource';
import { describeError } from '@/api/errors';
import { useAuth } from '@/auth/auth-provider';
import { LivePill } from '@/features/shell/ConnectionPill';
import { Avatar } from '@/ui/Avatar';
import { Badge } from '@/ui/Badge';
import { Icon } from '@/ui/icons';
import { PageHeader } from '@/ui/PageHeader';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { PersonSheet } from './PersonSheet';
import styles from './Ahora.module.css';

/** Pause that groups the burst of events of one scan into a single refetch. */
export const REFETCH_DEBOUNCE_MS = 300;

function PersonRow({
  person,
  detail,
}: {
  person: PanelPerson;
  detail: (person: PanelPerson) => React.ReactNode;
}) {
  return (
    <>
      <Avatar name={person.name} id={person.studentId} />
      <div className={styles.who}>
        <div className={styles.name}>{person.name}</div>
        <div className={styles.sub}>{person.document}</div>
      </div>
      <div className={styles.detail}>{detail(person)}</div>
    </>
  );
}

function PersonList({
  title,
  people,
  empty,
  detail,
  onSelect,
  openId,
}: {
  title: string;
  people: readonly PanelPerson[];
  empty: string;
  detail: (person: PanelPerson) => React.ReactNode;
  /** When given, every row is a button that opens the student's card. */
  onSelect?: (person: PanelPerson) => void;
  openId?: string | null;
}) {
  return (
    <section className={`card ${styles.listCard}`} aria-label={title}>
      <div className={styles.cardHead}>
        <h2>{title}</h2>
        <span className={styles.cardCount}>
          {people.length} {people.length === 1 ? 'persona' : 'personas'}
        </span>
      </div>
      {people.length === 0 ? (
        <p className={styles.emptyText}>{empty}</p>
      ) : (
        <ul className={styles.list}>
          {people.map((person) => (
            <li key={person.studentId} data-testid="person">
              {onSelect ? (
                <button
                  type="button"
                  className={`${styles.row} ${styles.rowButton} ${openId === person.studentId ? styles.rowOpen : ''}`}
                  aria-label={`Ver ficha de ${person.name}`}
                  onClick={() => onSelect(person)}
                >
                  <PersonRow person={person} detail={detail} />
                </button>
              ) : (
                <div className={styles.row}>
                  <PersonRow person={person} detail={detail} />
                </div>
              )}
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
    <section
      className={`card ${styles.listCard}`}
      aria-label="Últimos escaneos"
    >
      <div className={styles.cardHead}>
        <h2>Últimos escaneos</h2>
      </div>
      {feed.length === 0 ? (
        <p className={styles.emptyText}>
          Todavía no se ha escaneado ninguna huella.
        </p>
      ) : (
        <ul className={styles.list}>
          {feed.map((scan) => (
            <li key={scan.key} className={styles.row}>
              <div className={styles.who}>
                <div className={styles.name}>
                  {scan.data.studentName ?? 'Sin identificar'}
                </div>
                <div className={styles.sub}>{formatTimeSeconds(scan.at)}</div>
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
                  <div className={styles.sub}>
                    {rejectLabel(scan.data.reason)}
                  </div>
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
  // The failed refresh the user already closed; a new failure is a new object.
  const [dismissedError, setDismissedError] = useState<unknown>(null);
  const snapshot = useResource(async (signal) => {
    const data = await call(getApi().client.GET('/panel/now', { signal }));
    setClockOffset(Date.parse(data.serverNow) - Date.now());
    return data;
  }, []);
  const [feed, setFeed] = useState<ScanEntry[]>([]);
  const { role } = useAuth();
  const router = useRouter();
  // The card follows the live snapshot; the last known data stay if the person leaves both lists.
  const [sheet, setSheet] = useState<PanelPerson | null>(null);

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
  const sheetPerson =
    sheet === null
      ? null
      : ([...inside, ...missing, ...exited].find(
          (p) => p.studentId === sheet.studentId,
        ) ?? sheet);
  const eyebrow = `${role === 'admin' ? 'Administrador' : 'Asistente'} · ${formatLongDay(snapshot.data.serverNow)}`;
  const total = current
    ? Math.max(1, Date.parse(current.endsAt) - Date.parse(current.startsAt))
    : 1;
  const elapsed =
    current && remaining !== null
      ? Math.min(1, Math.max(0, 1 - (remaining * 1000) / total))
      : 0;
  return (
    <>
      <PageHeader eyebrow={eyebrow} title="Ahora" aside={<LivePill />} />
      <div className={styles.body}>
        {snapshot.error && snapshot.error !== dismissedError ? (
          <Notice
            kind="warning"
            title="No se pudo actualizar"
            onDismiss={() => setDismissedError(snapshot.error)}
          >
            {describeError(snapshot.error)} Se muestra el último estado
            conocido.
          </Notice>
        ) : null}
        {current ? (
          <section className={styles.hero} aria-label="Horario en curso">
            <div className={styles.heroMain}>
              <div className={styles.kicker}>
                Horario en curso · <strong>{current.scheduleName}</strong>
              </div>
              <div className={styles.range}>
                {formatTime(current.startsAt)} – {formatTime(current.endsAt)}
              </div>
              <div className={styles.heroNote}>
                {current.entryOpen
                  ? `Entrada abierta hasta las ${formatTime(current.entryClosesAt)}`
                  : 'Entrada cerrada'}{' '}
                <Badge tone={current.entryOpen ? 'success' : 'warning'}>
                  {current.entryOpen ? 'Ingreso abierto' : 'Ingreso cerrado'}
                </Badge>
              </div>
              <div className={styles.progress}>
                <div className={styles.track}>
                  <div
                    className={styles.fill}
                    style={{ width: `${Math.round(elapsed * 100)}%` }}
                  />
                </div>
                <div className={styles.progressLabels}>
                  <span>Inició {formatTime(current.startsAt)}</span>
                  <span>Termina {formatTime(current.endsAt)}</span>
                </div>
              </div>
              {remaining !== null && (
                <div className={styles.clock} aria-live="off">
                  <span>Tiempo restante</span>
                  <span className={styles.countdown} data-testid="countdown">
                    {formatCountdown(remaining)}
                  </span>
                </div>
              )}
            </div>
            <div className={styles.heroSide}>
              <div className={styles.donut}>
                <svg
                  viewBox="0 0 100 100"
                  width="128"
                  height="128"
                  role="img"
                  aria-label={`${counts.inside} de ${counts.expected} dentro`}
                >
                  <circle
                    cx="50"
                    cy="50"
                    r="44"
                    fill="none"
                    stroke="rgba(255,255,255,.2)"
                    strokeWidth="9"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="44"
                    fill="none"
                    stroke="var(--live-soft)"
                    strokeWidth="9"
                    strokeLinecap="round"
                    strokeDasharray={`${(counts.expected > 0 ? Math.min(1, counts.inside / counts.expected) : 0) * 276.5} 276.5`}
                    transform="rotate(-90 50 50)"
                  />
                </svg>
                <div className={styles.donutCenter}>
                  <div className={styles.donutNumber}>{counts.inside}</div>
                  <div className={styles.donutOf}>de {counts.expected}</div>
                </div>
              </div>
              <ul className={styles.legend}>
                <li>
                  <span
                    aria-hidden="true"
                    className={styles.swatch}
                    style={{ background: 'var(--live-soft)' }}
                  />
                  <strong>{counts.inside}</strong>Dentro
                </li>
                <li>
                  <span
                    aria-hidden="true"
                    className={styles.swatch}
                    style={{ background: 'rgba(255,255,255,.35)' }}
                  />
                  <strong>{counts.missing}</strong>Faltan
                </li>
                <li>
                  <span
                    aria-hidden="true"
                    className={styles.swatch}
                    style={{ background: 'var(--accent)' }}
                  />
                  <strong>{counts.exited}</strong>Salieron
                </li>
              </ul>
            </div>
          </section>
        ) : (
          <p className={`card ${styles.empty} muted`}>
            No hay un horario en curso.
          </p>
        )}
        <div className={styles.lists}>
          <PersonList
            title="Dentro"
            people={inside}
            empty={current ? 'Nadie está dentro.' : 'Nadie sigue dentro.'}
            onSelect={setSheet}
            openId={sheet?.studentId ?? null}
            detail={(person) => (
              <>
                {person.enteredAt && (
                  <span className={styles.entered}>
                    Entró {formatTime(person.enteredAt)}
                  </span>
                )}
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
              onSelect={setSheet}
              openId={sheet?.studentId ?? null}
              detail={(person) =>
                person.hasFingerprint ? null : (
                  <span className={styles.noPrint}>
                    <Icon name="huella" size={13} strokeWidth={2} />
                    Sin huella
                  </span>
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
                  <span className={styles.sub}>
                    {person.enteredAt && formatTime(person.enteredAt)} –{' '}
                    {person.exitedAt && formatTime(person.exitedAt)}
                  </span>
                )
              }
            />
          )}
        </div>
        <p className={styles.footnote}>
          Toque una persona para ver su ficha y, si hace falta, asignarle la
          huella.
        </p>
        <ScanFeed feed={feed} />
      </div>
      <PersonSheet
        person={sheetPerson}
        onClose={() => setSheet(null)}
        onAssign={(studentId) =>
          router.push(`/enrolar?estudiante=${encodeURIComponent(studentId)}`)
        }
      />
    </>
  );
}
