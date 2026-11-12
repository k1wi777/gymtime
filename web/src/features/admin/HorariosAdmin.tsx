'use client';

import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type {
  BulkAssignResult,
  Period,
  Regeneration,
  Schedule,
  Student,
} from '@/api/types';
import {
  dayFilterOptions,
  filterByDay,
  firstDayWithSchedules,
  groupByWeekday,
  weekdayOf,
} from '@/lib/schedule-groups';
import { bogotaDay } from '@/lib/time';
import { isTime } from '@/lib/time-select';
import { useResource } from '@/lib/use-resource';
import { type FieldErrors } from '@/lib/validators';
import { Badge } from '@/ui/Badge';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { DatePicker } from '@/ui/DatePicker';
import { DayFilter } from '@/ui/DayFilter';
import { FormModal, useCloseRequest } from '@/ui/FormModal';
import { useInModal, useModalFooter } from '@/ui/Modal';
import { Avatar } from '@/ui/Avatar';
import { FormActions, SelectField, TextField, useForm } from '@/ui/Form';
import { Icon } from '@/ui/icons';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { Spinner } from '@/ui/Spinner';
import { TimeSelect } from '@/ui/TimeSelect';
import { AddStudentsModal } from './AddStudentsModal';
import { RowMenu } from './RowMenu';
import { RegenerationNotice } from './RegenerationNotice';
import styles from './Admin.module.css';
import view from './HorariosAdmin.module.css';

export const WEEKDAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

const END_BEFORE_START = 'La hora de fin debe ser posterior a la de inicio.';
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
  if (!isTime(values.start)) errors.start = 'Elija la hora de inicio.';
  if (!isTime(values.end)) errors.end = 'Elija la hora de fin.';
  else if (isTime(values.start) && values.end <= values.start) {
    errors.end = END_BEFORE_START;
  }
  return errors;
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
  const formId = useId();
  const inModal = useInModal();
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
  // Warned as soon as both times are chosen, under the fields.
  const endOrder =
    isTime(form.values.start) &&
    isTime(form.values.end) &&
    form.values.end <= form.values.start;
  return (
    <form
      id={formId}
      className={inModal ? 'stack' : `card ${view.formCard}`}
      onSubmit={form.submit}
      noValidate
      aria-label={schedule ? `Editar ${schedule.name}` : 'Nuevo horario'}
    >
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}
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
      <div className={view.times}>
        <TimeSelect
          label="Hora de inicio"
          value={form.values.start}
          onChange={(v) => form.setValue('start', v)}
          error={form.errors.start}
          help="Hora de Colombia"
        />
        <TimeSelect
          label="Hora de fin"
          value={form.values.end}
          onChange={(v) => form.setValue('end', v)}
          error={endOrder ? undefined : form.errors.end}
        />
      </div>
      {endOrder && (
        <p className={view.order} role="alert">
          {END_BEFORE_START}
        </p>
      )}
      <FormActions
        formId={formId}
        busy={form.submitting}
        submitLabel={schedule ? 'Guardar cambios' : 'Crear horario'}
        onCancel={onCancel}
      />
    </form>
  );
}

function AssignPanel({
  schedule,
  students,
  onChanged,
}: {
  schedule: Schedule;
  students: readonly Student[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const footer = useModalFooter();
  const requestClose = useCloseRequest();

  const remove = async (student: Schedule['students'][number]) => {
    setBusy(true);
    setFailure(null);
    try {
      await call(
        getApi().client.DELETE('/schedules/{id}/students/{studentId}', {
          params: { path: { id: schedule.id, studentId: student.id } },
        }),
      );
      onChanged();
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const close = (
    <div className="row">
      <button type="button" className="btn" onClick={requestClose ?? undefined}>
        Cerrar
      </button>
    </div>
  );
  const count = schedule.students.length;

  return (
    <div className={view.assign}>
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}
      <div className={view.assignHead}>
        <span className={view.assignCount}>
          <strong>{count}</strong>{' '}
          {count === 1 ? 'estudiante asignado' : 'estudiantes asignados'}
        </span>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setAdding(true)}
        >
          <Icon name="mas" size={15} strokeWidth={2.2} />
          Agregar estudiantes
        </button>
      </div>
      {count === 0 ? (
        <p className={view.assignEmpty}>Nadie asignado todavía.</p>
      ) : (
        <ul className={view.assignList}>
          {schedule.students.map((s) => (
            <li key={s.id} className={view.assignRow}>
              <Avatar name={s.name} id={s.id} size={34} fontSize={12} />
              <div className={view.assignWho}>
                <div className={view.assignName}>
                  {s.name} {!s.active && <Badge tone="warning">De baja</Badge>}
                </div>
                <div className={view.assignDoc}>{s.document}</div>
              </div>
              <button
                type="button"
                className={`btn ${view.remove}`}
                aria-label={`Quitar a ${s.name}`}
                disabled={busy}
                onClick={() => void remove(s)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      <AddStudentsModal
        open={adding}
        schedule={schedule}
        students={students}
        onClose={() => setAdding(false)}
        onAdded={onChanged}
      />
      {footer ? createPortal(close, footer) : close}
    </div>
  );
}

interface WeekActions {
  onStudents: (schedule: Schedule) => void;
  onEdit: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
}

/**
 * The typical week of the period, built from its schedules: one column per
 * weekday, no dates. With `actions` (the «Todos» filter, where the cards are
 * not shown) each slot carries «Estudiantes» and a «Más» menu.
 */
function WeekView({
  schedules,
  actions,
}: {
  schedules: readonly Schedule[];
  actions?: WeekActions;
}) {
  const days = groupByWeekday(schedules);
  return (
    <section className={`card ${view.weekCard}`} aria-label="Vista semanal">
      <div className={view.weekHead}>
        <h2 className={view.weekTitle}>Vista semanal</h2>
      </div>
      <div className={view.weekScroll}>
        <table className={view.week}>
          <caption className="visually-hidden">Semana tipo del periodo</caption>
          <thead>
            <tr>
              {days.map((day) => (
                <th scope="col" key={day.weekday} className={view.dayHead}>
                  <div className={view.dayBox}>
                    <div className={view.dayName}>
                      {WEEKDAYS[day.weekday - 1]}
                    </div>
                    <div className={view.dayDate}>
                      {day.schedules.length}{' '}
                      {day.schedules.length === 1 ? 'horario' : 'horarios'}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {days.map((day) => (
                <td key={day.weekday} className={view.dayBody}>
                  {day.schedules.map((s) => {
                    const when = `${day.longLabel} ${hhmm(s.startTime)}–${hhmm(s.endTime)}`;
                    return (
                      <div
                        key={s.id}
                        className={`${view.slot} ${actions ? view.slotWithActions : ''}`}
                        title={s.name}
                      >
                        <span className="visually-hidden">{s.name}: </span>
                        <div className={view.slotHour}>
                          {hhmm(s.startTime)}–{hhmm(s.endTime)}
                        </div>
                        {actions ? (
                          <div className={view.slotActions}>
                            <button
                              type="button"
                              className="btn btn-s"
                              aria-label={`Estudiantes ${when}`}
                              onClick={() => actions.onStudents(s)}
                            >
                              Estudiantes
                            </button>
                            <RowMenu
                              label={`Más acciones de ${when}`}
                              items={[
                                {
                                  key: 'edit',
                                  label: 'Editar',
                                  onSelect: () => actions.onEdit(s),
                                },
                                {
                                  key: 'delete',
                                  label: 'Eliminar',
                                  danger: true,
                                  onSelect: () => actions.onDelete(s),
                                },
                              ]}
                            />
                          </div>
                        ) : (
                          <div className={view.slotCount}>
                            {s.students.length} estudiantes
                          </div>
                        )}
                      </div>
                    );
                  })}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScheduleCard({
  schedule,
  onStudents,
  onEdit,
  onDelete,
}: {
  schedule: Schedule;
  onStudents: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const weekday = weekdayOf(schedule);
  const dayName = (weekday ? WEEKDAYS[weekday - 1] : '') ?? '';
  return (
    <section
      className={`card ${view.card}`}
      aria-label={`Horario ${schedule.name}`}
    >
      <div className={view.cardHead}>
        <div aria-hidden="true" className={view.dayBadge}>
          <span className={view.dayAbbr}>
            {dayName.slice(0, 3).toUpperCase()}
          </span>
          <span className={view.dayStart}>{hhmm(schedule.startTime)}</span>
        </div>
        <div className={view.cardTitleBox}>
          <h2 className={view.cardTitle}>{schedule.name}</h2>
          <div className={view.cardRange}>
            {dayName} {hhmm(schedule.startTime)}–{hhmm(schedule.endTime)}
          </div>
        </div>
        <Badge tone="mint">{schedule.students.length} estudiantes</Badge>
      </div>
      <div className={view.cardActions}>
        <button type="button" className="btn btn-s" onClick={onStudents}>
          Estudiantes
        </button>
        <button type="button" className="btn btn-s" onClick={onEdit}>
          Editar
        </button>
        <button
          type="button"
          className="btn btn-s btn-outline-danger"
          onClick={onDelete}
        >
          Eliminar
        </button>
      </div>
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
  const [studentsOf, setStudentsOf] = useState<string | null>(null);
  // undefined = nobody chose yet: the first day with schedules is active.
  const [chosenDay, setChosenDay] = useState<number | null | undefined>();

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

  const options = dayFilterOptions(mine);
  const day =
    chosenDay === null ||
    (chosenDay !== undefined && options.some((o) => o.weekday === chosenDay))
      ? chosenDay
      : firstDayWithSchedules(mine);
  const assigning = mine.find((s) => s.id === studentsOf);

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
    <div>
      <PageHeader
        crumb="Gestión de horarios"
        title="Gestión de horarios"
        lead="Los horarios semanales pertenecen a un periodo. Al crear o cambiar uno se generan sus sesiones hasta el fin del periodo, sin los días sin servicio."
        aside={
          period ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setMode('new')}
            >
              <Icon name="mas" size={17} strokeWidth={2} />
              Nuevo horario
            </button>
          ) : undefined
        }
      />
      <div className={view.main}>
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
            <div className={view.periodSelect}>
              <SelectField
                label="Periodo"
                value={period.id}
                onChange={(v) => {
                  setChosen(v);
                  setChosenDay(undefined);
                  setMode('none');
                  setStudentsOf(null);
                }}
                options={(periods.data ?? []).map((p) => ({
                  value: p.id,
                  label: `${p.name}${p.active ? ' (activo)' : ''}`,
                }))}
              />
            </div>
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
            <FormModal
              open={mode !== 'none'}
              title={
                typeof mode === 'object'
                  ? `Editar ${mode.edit.name}`
                  : 'Nuevo horario'
              }
              onClose={() => setMode('none')}
            >
              <ScheduleForm
                key={typeof mode === 'object' ? mode.edit.id : 'new'}
                period={period}
                {...(typeof mode === 'object' ? { schedule: mode.edit } : {})}
                onSaved={saved}
                onCancel={() => setMode('none')}
              />
            </FormModal>
            <FormModal
              open={assigning !== undefined}
              title="Estudiantes del horario"
              description={
                assigning
                  ? `${assigning.name} · Quién puede entrar en este horario.`
                  : ''
              }
              size="w560"
              onClose={() => setStudentsOf(null)}
            >
              {assigning && (
                <AssignPanel
                  schedule={assigning}
                  students={students.data ?? []}
                  onChanged={schedules.reload}
                />
              )}
            </FormModal>
            {schedules.loading && !schedules.data && <Spinner />}
            {schedules.data && mine.length === 0 && (
              <p className="muted">Este periodo no tiene horarios.</p>
            )}
            {options.length > 0 && (
              <DayFilter
                label="Día"
                options={options}
                value={day}
                onChange={setChosenDay}
              />
            )}
            {day !== null && (
              <div className={view.cards}>
                {filterByDay(mine, day).map((schedule) => (
                  <ScheduleCard
                    key={schedule.id}
                    schedule={schedule}
                    onStudents={() => setStudentsOf(schedule.id)}
                    onEdit={() => setMode({ edit: schedule })}
                    onDelete={() => setToDelete(schedule)}
                  />
                ))}
              </div>
            )}
            {mine.length > 0 && (
              <WeekView
                schedules={mine}
                {...(day === null
                  ? {
                      actions: {
                        onStudents: (schedule: Schedule) =>
                          setStudentsOf(schedule.id),
                        onEdit: (schedule: Schedule) =>
                          setMode({ edit: schedule }),
                        onDelete: setToDelete,
                      },
                    }
                  : {})}
              />
            )}
          </>
        )}
      </div>
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
