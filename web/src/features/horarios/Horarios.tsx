'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { RosterRow } from '@/api/types';
import { SOURCE_LABELS } from '@/lib/labels';
import { bogotaDay, formatDay, formatTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { Badge } from '@/ui/Badge';
import { DataTable, type Column, type SelectFilter } from '@/ui/DataTable';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { SelectField } from '@/ui/Form';

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

export function Horarios() {
  const schedules = useResource(
    (signal) => call(getApi().client.GET('/schedules', { signal })),
    [],
  );
  const [scheduleId, setScheduleId] = useState('');
  const [date, setDate] = useState(() => bogotaDay(new Date()));

  return (
    <div className="stack">
      <h1>Horarios</h1>
      <p className="muted">
        Consulte quiénes debían asistir, quiénes asistieron y quiénes faltaron
        en cualquier día.
      </p>
      {schedules.error ? (
        <Notice kind="error">{describeError(schedules.error)}</Notice>
      ) : (
        <div className="row" style={{ alignItems: 'flex-end' }}>
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
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
          >
            <label htmlFor="roster-date">
              <strong>Fecha</strong>
            </label>
            <input
              id="roster-date"
              type="date"
              value={date}
              onChange={(event) =>
                event.target.value && setDate(event.target.value)
              }
              style={{
                padding: '0.5rem 0.65rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
              }}
            />
          </div>
        </div>
      )}
      {scheduleId && <Roster scheduleId={scheduleId} date={date} />}
    </div>
  );
}
