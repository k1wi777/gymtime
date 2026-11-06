'use client';

import { useMemo, useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type {
  BulkAssignResult,
  Period,
  Regeneration,
  Schedule,
  Student,
  Week,
} from '@/api/types';
import { bogotaDay, formatDay } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { type FieldErrors } from '@/lib/validators';
import { Badge } from '@/ui/Badge';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SelectField, SubmitButton, TextField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { RegenerationNotice } from './RegenerationNotice';
import styles from './Admin.module.css';

export const WEEKDAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmm = (value: string): string => value.slice(0, 5);

interface ScheduleValues {
  name: string;
  weekday: string;
  start: string;
  end: string;
}

export function validateSchedule(
  values: ScheduleValues,
): FieldErrors<ScheduleValues> {
  const errors: FieldErrors<ScheduleValues> = {};
  if (values.name.trim() === '') errors.name = 'Escriba el nombre.';
  if (values.weekday === '') errors.weekday = 'Elija el día de la semana.';
  if (!TIME.test(values.start)) errors.start = 'Use la hora como HH:MM.';
  if (!TIME.test(values.end)) errors.end = 'Use la hora como HH:MM.';
  else if (TIME.test(values.start) && values.end <= values.start) {
    errors.end = 'La hora de fin debe ser posterior a la de inicio.';
  }
  return errors;
}

/** Document numbers pasted or read from a text file: one per line, comma or semicolon. */
export function parseDocuments(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const document = part.trim();
    if (document) seen.add(document);
  }
  return [...seen];
}

/** `validFrom` for the API: nothing for "now", midnight Bogota for a later day. */
export function validFromOf(day: string, today = bogotaDay(new Date())) {
  return day && day > today ? `${day}T00:00:00-05:00` : undefined;
}

function ScheduleForm({
  period,
  schedule,
  onSaved,
  onCancel,
}: {
  period: Period;
  schedule?: Schedule;
  onSaved: (result: Regeneration | null) => void;
  onCancel: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<ScheduleValues>({
    initial: {
      name: schedule?.name ?? '',
      weekday: schedule?.weekday ? String(schedule.weekday) : '',
      start: schedule ? hhmm(schedule.startTime) : '',
      end: schedule ? hhmm(schedule.endTime) : '',
    },
    validate: validateSchedule,
    onSubmit: async (values) => {
      setFailure(null);
      const body = {
        name: values.name.trim(),
        weekday: Number(values.weekday),
        start: values.start,
        end: values.end,
      };
      try {
        if (schedule) {
          const updated = await call(
            getApi().client.PATCH('/schedules/{id}', {
              params: { path: { id: schedule.id } },
              body,
            }),
          );
          onSaved(updated.regeneration ?? null);
        } else {
          const created = await call(
            getApi().client.POST('/schedules', {
              body: { ...body, periodId: period.id },
            }),
          );
          onSaved(created.regeneration ?? null);
        }
      } catch (error) {
        setFailure(describeError(error));
      }
    },
  });
  return (
    <form
      className="card stack"
      onSubmit={form.submit}
      noValidate
      aria-label={schedule ? `Editar ${schedule.name}` : 'Nuevo horario'}
    >
      <h2>{schedule ? `Editar ${schedule.name}` : 'Nuevo horario'}</h2>
      {failure && <Notice kind="error">{failure}</Notice>}
      <TextField
        label="Nombre"
        value={form.values.name}
        onChange={(v) => form.setValue('name', v)}
        onBlur={() => form.blur('name')}
        error={form.errors.name}
        maxLength={200}
      />
      <SelectField
        label="Día de la semana"
        placeholder="Elija un día"
        value={form.values.weekday}
        onChange={(v) => form.setValue('weekday', v)}
        onBlur={() => form.blur('weekday')}
        error={form.errors.weekday}
        options={WEEKDAYS.map((label, i) => ({
          value: String(i + 1),
          label,
        }))}
      />
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <TextField
          label="Inicio"
          value={form.values.start}
          onChange={(v) => form.setValue('start', v)}
          onBlur={() => form.blur('start')}
          error={form.errors.start}
          help="HH:MM, hora de Colombia"
          maxLength={5}
        />
        <TextField
          label="Fin"
          value={form.values.end}
          onChange={(v) => form.setValue('end', v)}
          onBlur={() => form.blur('end')}
          error={form.errors.end}
          help="HH:MM"
          maxLength={5}
        />
      </div>
      <div className="row">
        <SubmitButton busy={form.submitting}>
          {schedule ? 'Guardar cambios' : 'Crear horario'}
        </SubmitButton>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function AssignPanel({
  schedule,
  others,
  students,
  onChanged,
}: {
  schedule: Schedule;
  others: readonly Schedule[];
  students: readonly Student[];
  onChanged: () => void;
}) {
  const [studentId, setStudentId] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [bulk, setBulk] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkAssignResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const assignedIds = useMemo(
    () => new Set(schedule.students.map((s) => s.id)),
    [schedule.students],
  );
  const candidates = students.filter((s) => s.active && !assignedIds.has(s.id));

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    setMessage(null);
    try {
      await action();
      onChanged();
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const readFile = async (file: File | undefined) => {
    if (file) setBulk(await file.text());
  };

  return (
    <div className="stack">
      {failure && <Notice kind="error">{failure}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <h3>Estudiantes asignados ({schedule.students.length})</h3>
      {schedule.students.length === 0 ? (
        <p className="muted">Nadie asignado todavía.</p>
      ) : (
        <ul className={styles.chips}>
          {schedule.students.map((s) => (
            <li key={s.id}>
              {s.name} <span className="muted">{s.document}</span>{' '}
              {!s.active && <Badge tone="warning">De baja</Badge>}{' '}
              <button
                type="button"
                className="btn"
                aria-label={`Quitar a ${s.name}`}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await call(
                      getApi().client.DELETE(
                        '/schedules/{id}/students/{studentId}',
                        {
                          params: {
                            path: { id: schedule.id, studentId: s.id },
                          },
                        },
                      ),
                    );
                  })
                }
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <SelectField
          label="Asignar un estudiante"
          placeholder="Elija un estudiante"
          value={studentId}
          onChange={setStudentId}
          options={candidates.map((s) => ({
            value: s.id,
            label: `${s.name} · ${s.document}`,
          }))}
        />
        <TextField
          label="Desde (opcional)"
          value={validFrom}
          onChange={setValidFrom}
          help="AAAA-MM-DD; vacío = desde ahora"
          maxLength={10}
        />
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || studentId === ''}
          onClick={() =>
            void run(async () => {
              const from = validFromOf(validFrom);
              await call(
                getApi().client.PUT('/schedules/{id}/students/{studentId}', {
                  params: { path: { id: schedule.id, studentId } },
                  body: from ? { validFrom: from } : {},
                }),
              );
              setStudentId('');
              setMessage('Estudiante asignado.');
            })
          }
        >
          Asignar
        </button>
      </div>

      <div className="stack">
        <label htmlFor={`bulk-${schedule.id}`}>
          <strong>Asignar varios por documento</strong>
        </label>
        <textarea
          id={`bulk-${schedule.id}`}
          rows={4}
          value={bulk}
          onChange={(event) => setBulk(event.target.value)}
          placeholder="Un documento por línea (o separados por coma)"
          className={styles.textarea}
        />
        <div className="row">
          <label>
            <span className="visually-hidden">Cargar archivo de texto</span>
            <input
              type="file"
              accept=".txt,.csv,text/plain"
              onChange={(event) => void readFile(event.target.files?.[0])}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={busy || parseDocuments(bulk).length === 0}
            onClick={() =>
              void run(async () => {
                const result = await call(
                  getApi().client.POST('/schedules/{id}/students/bulk', {
                    params: { path: { id: schedule.id } },
                    body: { documents: parseDocuments(bulk) },
                  }),
                );
                setBulkResult(result);
                setBulk('');
              })
            }
          >
            Asignar lista
          </button>
        </div>
        {bulkResult && (
          <Notice kind="info" title="Resultado de la asignación">
            <ul>
              <li>Asignados: {bulkResult.assigned.length}</li>
              <li>Ya estaban asignados: {bulkResult.alreadyAssigned.length}</li>
              <li>
                De baja (no se asignaron):{' '}
                {bulkResult.inactive.map((s) => s.document).join(', ') || '0'}
              </li>
              <li>No existen: {bulkResult.notFound.join(', ') || '0'}</li>
            </ul>
          </Notice>
        )}
      </div>

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <SelectField
          label="Copiar estudiantes de otro horario"
          placeholder="Elija un horario"
          value={copyFrom}
          onChange={setCopyFrom}
          options={others
            .filter((o) => o.id !== schedule.id)
            .map((o) => ({ value: o.id, label: o.name }))}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || copyFrom === ''}
          onClick={() =>
            void run(async () => {
              const result = await call(
                getApi().client.POST('/schedules/{id}/students/copy', {
                  params: { path: { id: schedule.id } },
                  body: { fromScheduleId: copyFrom },
                }),
              );
              setMessage(
                `Copiados: ${result.assigned}. Ya asignados: ${result.alreadyAssigned}. De baja omitidos: ${result.skippedInactive}.`,
              );
              setCopyFrom('');
            })
          }
        >
          Copiar
        </button>
      </div>
    </div>
  );
}

function WeekGrid({ week }: { week: Week }) {
  return (
    <div className={styles.scroll}>
      <table className={styles.week}>
        <caption className="visually-hidden">
          Semana del {formatDay(week.weekStart)}
        </caption>
        <thead>
          <tr>
            {week.days.map((day) => (
              <th
                scope="col"
                key={day.date}
                className={`${styles.weekHead} ${day.closedReason ? styles.closed : ''}`}
              >
                <strong>{WEEKDAYS[day.weekday - 1]}</strong>
                <br />
                <span className="muted">{formatDay(day.date)}</span>
                {day.closedReason && (
                  <>
                    <br />
                    <Badge tone="warning">
                      Sin servicio: {day.closedReason}
                    </Badge>
                  </>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {week.days.map((day) => (
              <td
                key={day.date}
                className={`${styles.weekCell} ${day.closedReason ? styles.closed : ''}`}
              >
                {!day.closedReason &&
                  week.schedules
                    .filter((s) => s.weekday === day.weekday)
                    .sort((a, b) => a.startTime.localeCompare(b.startTime))
                    .map((s) => (
                      <div key={s.id} className={styles.slot}>
                        <strong>{s.name}</strong>
                        <span>
                          {hhmm(s.startTime)}–{hhmm(s.endTime)}
                        </span>
                        <span className="muted">
                          {s.assignedCount} estudiantes
                        </span>
                      </div>
                    ))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function monday(day: string): string {
  const date = new Date(`${day}T12:00:00-05:00`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return bogotaDay(date);
}

const shiftDay = (day: string, days: number): string => {
  const date = new Date(`${day}T12:00:00-05:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return bogotaDay(date);
};

function WeekView({ periodId }: { periodId: string }) {
  const [weekStart, setWeekStart] = useState(() =>
    monday(bogotaDay(new Date())),
  );
  const week = useResource(
    (signal) =>
      call(
        getApi().client.GET('/panel/schedules/week', {
          params: { query: { periodId, weekStart } },
          signal,
        }),
      ),
    [periodId, weekStart],
  );
  return (
    <section className="stack" aria-label="Vista semanal">
      <h2>Vista semanal</h2>
      <div className="row">
        <button
          type="button"
          className="btn"
          onClick={() => setWeekStart(shiftDay(weekStart, -7))}
        >
          Semana anterior
        </button>
        <span>Semana del {formatDay(weekStart)}</span>
        <button
          type="button"
          className="btn"
          onClick={() => setWeekStart(shiftDay(weekStart, 7))}
        >
          Semana siguiente
        </button>
      </div>
      {week.loading && !week.data && <Spinner />}
      {week.error ? (
        <Notice kind="error">{describeError(week.error)}</Notice>
      ) : null}
      {week.data && <WeekGrid week={week.data} />}
    </section>
  );
}

export function HorariosAdmin() {
  const periods = useResource(
    (signal) => call(getApi().client.GET('/periods', { signal })),
    [],
  );
  const schedules = useResource(
    (signal) => call(getApi().client.GET('/schedules', { signal })),
    [],
  );
  const students = useResource(
    (signal) => call(getApi().client.GET('/students', { signal })),
    [],
  );
  const [chosen, setChosen] = useState('');
  const [mode, setMode] = useState<'none' | 'new' | { edit: Schedule }>('none');
  const [result, setResult] = useState<Regeneration | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const period: Period | undefined =
    periods.data?.find((p) => p.id === chosen) ??
    periods.data?.find((p) => p.active) ??
    periods.data?.[0];
  const mine = (schedules.data ?? [])
    .filter((s) => s.periodId === period?.id)
    .sort(
      (a, b) =>
        (a.weekday ?? 0) - (b.weekday ?? 0) ||
        a.startTime.localeCompare(b.startTime),
    );

  const saved = (regeneration: Regeneration | null) => {
    setMode('none');
    setResult(regeneration);
    schedules.reload();
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    setFailure(null);
    try {
      await call(
        getApi().client.DELETE('/schedules/{id}', {
          params: { path: { id: toDelete.id } },
        }),
      );
      schedules.reload();
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  };

  return (
    <div className="stack">
      <h1>Gestión de horarios</h1>
      <p className="muted">
        Los horarios semanales pertenecen a un periodo. Al crear o cambiar uno
        se generan sus sesiones hasta el fin del periodo, sin los días sin
        servicio.
      </p>
      {periods.error ? (
        <Notice kind="error">{describeError(periods.error)}</Notice>
      ) : null}
      {periods.data && periods.data.length === 0 && (
        <Notice kind="warning" title="Falta un periodo">
          Cree primero un periodo en la sección Periodos.
        </Notice>
      )}
      {period && (
        <>
          <SelectField
            label="Periodo"
            value={period.id}
            onChange={(v) => {
              setChosen(v);
              setMode('none');
              setOpenId(null);
            }}
            options={(periods.data ?? []).map((p) => ({
              value: p.id,
              label: `${p.name}${p.active ? ' (activo)' : ''}`,
            }))}
          />
          {failure && (
            <Notice kind="error" onDismiss={() => setFailure(null)}>
              {failure}
            </Notice>
          )}
          {result && (
            <RegenerationNotice
              result={result}
              onDismiss={() => setResult(null)}
            />
          )}
          {mode === 'none' && (
            <div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setMode('new')}
              >
                Nuevo horario
              </button>
            </div>
          )}
          {mode === 'new' && (
            <ScheduleForm
              period={period}
              onSaved={saved}
              onCancel={() => setMode('none')}
            />
          )}
          {typeof mode === 'object' && (
            <ScheduleForm
              key={mode.edit.id}
              period={period}
              schedule={mode.edit}
              onSaved={saved}
              onCancel={() => setMode('none')}
            />
          )}
          {schedules.loading && !schedules.data && <Spinner />}
          {schedules.data && mine.length === 0 && (
            <p className="muted">Este periodo no tiene horarios.</p>
          )}
          {mine.map((schedule) => (
            <section
              key={schedule.id}
              className="card stack"
              aria-label={`Horario ${schedule.name}`}
            >
              <div className="row">
                <h2>{schedule.name}</h2>
                <span>
                  {schedule.weekday ? WEEKDAYS[schedule.weekday - 1] : ''}{' '}
                  {hhmm(schedule.startTime)}–{hhmm(schedule.endTime)}
                </span>
                <Badge>{schedule.students.length} estudiantes</Badge>
              </div>
              <div className="row">
                <button
                  type="button"
                  className="btn"
                  aria-expanded={openId === schedule.id}
                  onClick={() =>
                    setOpenId(openId === schedule.id ? null : schedule.id)
                  }
                >
                  {openId === schedule.id
                    ? 'Ocultar estudiantes'
                    : 'Estudiantes'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setMode({ edit: schedule })}
                >
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setToDelete(schedule)}
                >
                  Eliminar
                </button>
              </div>
              {openId === schedule.id && (
                <AssignPanel
                  schedule={schedule}
                  others={mine}
                  students={students.data ?? []}
                  onChanged={schedules.reload}
                />
              )}
            </section>
          ))}
          <WeekView periodId={period.id} />
        </>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title="Eliminar horario"
        tone="danger"
        confirmLabel="Eliminar"
        busy={busy}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void remove()}
      >
        <p>
          Se eliminará «{toDelete?.name}» y sus sesiones futuras. Si ya tiene
          asistencia registrada, el servidor no lo permitirá.
        </p>
      </ConfirmDialog>
    </div>
  );
}
