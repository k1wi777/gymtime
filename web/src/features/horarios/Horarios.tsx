'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { RosterRow, Schedule } from '@/api/types';
import { avatarTone } from '@/lib/display';
import { useNow } from '@/lib/use-now';
import {
  phaseAt,
  schedulesOn,
  timeRange,
  weekOf,
  weekTitle,
  type DayPhase,
} from '@/lib/week';
import { SOURCE_LABELS } from '@/lib/labels';
import { bogotaDay, formatDay, formatLongDay, formatTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { Badge } from '@/ui/Badge';
import { DataTable, type Column, type SelectFilter } from '@/ui/DataTable';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { SelectField } from '@/ui/Form';
import { PageHeader } from '@/ui/PageHeader';
import styles from './Horarios.module.css';

const PHASES = {
  past: ['Pasado', 'neutral'],
  current: ['En curso', 'success'],
  future: ['Futuro', 'info'],
} as const;

const STATE_LABELS: Record<RosterRow['state'], string> = {
  attended: 'Asistió',
  missing: 'Faltó',
  expected: 'Se espera',
};

const PHASE_LABELS: Record<DayPhase, string> = {
  past: 'Pasado',
  current: 'En curso',
  upcoming: 'Próximo',
};

function Roster({ scheduleId, date }: { scheduleId: string; date: string }) {
  const roster = useResource(
    (signal) =>
      call(
        getApi().client.GET('/panel/schedules/{id}/roster', {
          params: { path: { id: scheduleId }, query: { date } },
          signal,
        }),
      ),
    [scheduleId, date],
  );

  if (roster.loading) return <Spinner />;
  if (roster.error || !roster.data) {
    return (
      <Notice
        kind="error"
        actions={
          <button type="button" className="btn" onClick={roster.reload}>
            Reintentar
          </button>
        }
      >
        {describeError(roster.error)}
      </Notice>
    );
  }
  const { occurrence, phase, counts, rows } = roster.data;
  if (!occurrence || !phase) {
    return (
      <Notice kind="info">
        Este horario no tiene una sesión el {formatDay(date)}.
      </Notice>
    );
  }
  const [phaseLabel, tone] = PHASES[phase];
  const columns: Column<RosterRow>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (r) => r.name,
      sortValue: (r) => r.name,
    },
    { key: 'document', header: 'Documento', render: (r) => r.document },
    {
      key: 'state',
      header: 'Estado',
      render: (r) => (
        <>
          <Badge
            tone={
              r.state === 'attended'
                ? 'success'
                : r.state === 'missing'
                  ? 'danger'
                  : 'neutral'
            }
          >
            {STATE_LABELS[r.state]}
          </Badge>{' '}
          {!r.assigned && <Badge tone="warning">No asignado</Badge>}
        </>
      ),
      sortValue: (r) => r.state,
    },
    {
      key: 'times',
      header: 'Entrada – salida',
      render: (r) =>
        r.enteredAt
          ? `${formatTime(r.enteredAt)} – ${r.exitedAt ? formatTime(r.exitedAt) : r.sessionStatus === 'no_registrada' ? 'no registrada' : '…'}`
          : '—',
    },
    {
      key: 'source',
      header: 'Origen',
      render: (r) => (r.source ? SOURCE_LABELS[r.source] : '—'),
    },
  ];
  const selects: SelectFilter<RosterRow>[] = [
    {
      id: 'state',
      label: 'Estado',
      options: Object.entries(STATE_LABELS).map(([value, label]) => ({
        value,
        label,
      })),
      matches: (r, value) => r.state === value,
    },
  ];
  return (
    <div className="stack">
      <p>
        <Badge tone={tone}>{phaseLabel}</Badge>{' '}
        {formatTime(occurrence.startsAt)} – {formatTime(occurrence.endsAt)}
        {' · '}
        Deben asistir: <strong>{counts.expected}</strong> · Asistieron:{' '}
        <strong>{counts.attended}</strong> · Faltaron/faltan:{' '}
        <strong>{counts.missing}</strong>
      </p>
      <DataTable
        caption="Listado del horario"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.studentId}
        searchText={(r) => `${r.name} ${r.document}`}
        selects={selects}
        emptyMessage="Nadie figura en este horario."
      />
    </div>
  );
}

function TodayCard({ schedules }: { schedules: readonly Schedule[] }) {
  const now = useNow(60_000);
  const today = weekOf(bogotaDay(new Date(now))).find(
    (day) => day.date === bogotaDay(new Date(now)),
  );
  const clock = formatTime(new Date(now));
  const items = today ? schedulesOn(schedules, today) : [];
  return (
    <section className={`card ${styles.today}`} aria-label="Horarios de hoy">
      <div className={styles.cardHead}>
        <h2>Hoy · {formatLongDay(new Date(now))}</h2>
      </div>
      {items.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Hoy no hay horarios.
        </p>
      ) : (
        <ol className={styles.timeline}>
          <span aria-hidden="true" className={styles.rail} />
          {items.map((schedule) => {
            const phase = phaseAt(schedule, clock);
            return (
              <li
                key={schedule.id}
                className={`${styles.entry} ${phase === 'past' ? styles.entryPast : phase === 'upcoming' ? styles.entryUpcoming : ''}`}
              >
                <span
                  aria-hidden="true"
                  className={`${styles.marker} ${phase === 'current' ? styles.markerNow : ''}`}
                />
                <div className={styles.entryLine}>
                  <span className={styles.entryRange}>
                    {timeRange(schedule)}
                  </span>
                  <span
                    className={`${styles.tag} ${phase === 'current' ? styles.tagNow : ''}`}
                  >
                    {PHASE_LABELS[phase]}
                  </span>
                </div>
                <div className={styles.entryName}>
                  {schedule.name} · {schedule.students.length}{' '}
                  {schedule.students.length === 1
                    ? 'estudiante asignado'
                    : 'estudiantes asignados'}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function WeekCard({ schedules }: { schedules: readonly Schedule[] }) {
  const now = useNow(60_000);
  const todayIso = bogotaDay(new Date(now));
  const days = weekOf(todayIso);
  return (
    <section className={`card ${styles.week}`} aria-label="Semana">
      <div className={styles.weekHead}>
        <h2>{weekTitle(days)}</h2>
      </div>
      <div className={styles.scroll}>
        <div className={styles.grid}>
          {days.map((day) => {
            const items = schedulesOn(schedules, day);
            return (
              <div
                key={day.date}
                className={`${styles.day} ${day.date === todayIso ? styles.dayNow : ''}`}
                aria-current={day.date === todayIso ? 'date' : undefined}
              >
                <span aria-hidden="true" className={styles.dayBar} />
                <div className={styles.dayTitle}>
                  <div className={styles.dayName}>{day.name}</div>
                  <div className={styles.dayNumber}>{day.number}</div>
                </div>
                {items.map((schedule) => (
                  <div
                    key={schedule.id}
                    className={`${styles.block} ${styles[`t${avatarTone(schedule.id)}`]}`}
                  >
                    {timeRange(schedule)}
                    <span>{schedule.students.length} est.</span>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className={styles.none}>Sin servicio</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function Horarios() {
  const schedules = useResource(
    (signal) => call(getApi().client.GET('/schedules', { signal })),
    [],
  );
  const [scheduleId, setScheduleId] = useState('');
  const [date, setDate] = useState(() => bogotaDay(new Date()));

  return (
    <>
      <PageHeader
        eyebrow="Asistente · Consulta"
        title="Horarios"
        lead="Consulte quiénes debían asistir, quiénes asistieron y quiénes faltaron en cualquier día."
      />
      <div className={styles.body}>
        {schedules.data && (
          <div className={styles.top}>
            <TodayCard schedules={schedules.data} />
            <WeekCard schedules={schedules.data} />
          </div>
        )}
        <section className={`card ${styles.query}`} aria-label="Consulta">
          <h2>Quiénes asistieron</h2>
          {schedules.error ? (
            <Notice kind="error">{describeError(schedules.error)}</Notice>
          ) : (
            <div className={styles.controls}>
              <SelectField
                label="Horario"
                placeholder="Elija un horario"
                value={scheduleId}
                onChange={setScheduleId}
                options={(schedules.data ?? []).map((s) => ({
                  value: s.id,
                  label: `${s.name} · ${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)}`,
                }))}
              />
              <div className={styles.field}>
                <label htmlFor="roster-date">Fecha</label>
                <input
                  id="roster-date"
                  type="date"
                  value={date}
                  onChange={(event) =>
                    event.target.value && setDate(event.target.value)
                  }
                  className={styles.date}
                />
              </div>
            </div>
          )}
          {scheduleId && <Roster scheduleId={scheduleId} date={date} />}
        </section>
      </div>
    </>
  );
}
