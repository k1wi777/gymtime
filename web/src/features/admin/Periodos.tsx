'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { Period, Regeneration } from '@/api/types';
import { bogotaDay, formatDay, formatShortDay } from '@/lib/time';
import { periodTimeline } from '@/lib/timeline';
import { useResource } from '@/lib/use-resource';
import { Badge } from '@/ui/Badge';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { DateRangePicker } from '@/ui/DatePicker';
import { Icon } from '@/ui/icons';
import { PageHeader } from '@/ui/PageHeader';
import { SubmitButton, TextField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import type { FieldErrors } from '@/lib/validators';
import { RegenerationNotice } from './RegenerationNotice';
import styles from './Periodos.module.css';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

interface PeriodValues {
  name: string;
  startDate: string;
  endDate: string;
}

export function validatePeriod(
  values: PeriodValues,
): FieldErrors<PeriodValues> {
  const errors: FieldErrors<PeriodValues> = {};
  if (values.name.trim() === '') errors.name = 'Escriba el nombre.';
  else if (values.name.trim().length > 100) {
    errors.name = 'El nombre admite hasta 100 caracteres.';
  }
  if (!DAY.test(values.startDate)) errors.startDate = 'Elija la fecha inicial.';
  if (!DAY.test(values.endDate)) errors.endDate = 'Elija la fecha final.';
  else if (DAY.test(values.startDate) && values.endDate < values.startDate) {
    errors.endDate = 'La fecha final no puede ser anterior a la inicial.';
  }
  return errors;
}

interface ExceptionValues {
  from: string;
  to: string;
  reason: string;
}

export function validateException(
  values: ExceptionValues,
): FieldErrors<ExceptionValues> {
  const errors: FieldErrors<ExceptionValues> = {};
  if (!DAY.test(values.from)) errors.from = 'Elija el primer día.';
  if (!DAY.test(values.to)) errors.to = 'Elija el último día.';
  else if (DAY.test(values.from) && values.to < values.from) {
    errors.to = 'El último día no puede ser anterior al primero.';
  }
  if (values.reason.trim() === '') errors.reason = 'Escriba el motivo.';
  return errors;
}

function PeriodForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: PeriodValues;
  submitLabel: string;
  onSubmit: (values: PeriodValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<PeriodValues>({
    initial,
    validate: validatePeriod,
    onSubmit: async (values) => {
      setFailure(null);
      try {
        await onSubmit({ ...values, name: values.name.trim() });
      } catch (error) {
        setFailure(describeError(error));
      }
    },
  });
  return (
    <form
      className={`card ${styles.formCard}`}
      onSubmit={form.submit}
      noValidate
      aria-label={
        submitLabel === 'Crear periodo' ? 'Nuevo periodo' : 'Editar periodo'
      }
    >
      {failure && <Notice kind="error">{failure}</Notice>}
      <TextField
        label="Nombre"
        value={form.values.name}
        onChange={(v) => form.setValue('name', v)}
        onBlur={() => form.blur('name')}
        error={form.errors.name}
        maxLength={100}
      />
      <DateRangePicker
        fromLabel="Primer día"
        toLabel="Último día"
        from={form.values.startDate}
        to={form.values.endDate}
        onChange={(range) => {
          form.setValue('startDate', range.from);
          form.setValue('endDate', range.to);
          form.blur('startDate');
          form.blur('endDate');
        }}
        shortcuts={['today', 'clear']}
        fromError={form.errors.startDate}
        toError={form.errors.endDate}
      />
      <div className={styles.actions}>
        <SubmitButton busy={form.submitting}>{submitLabel}</SubmitButton>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ExceptionForm({
  period,
  onDone,
}: {
  period: Period;
  onDone: (result: Regeneration) => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<ExceptionValues>({
    initial: { from: '', to: '', reason: '' },
    validate: validateException,
    onSubmit: async (values) => {
      setFailure(null);
      try {
        const result = await call(
          getApi().client.POST('/periods/{id}/exceptions', {
            params: { path: { id: period.id } },
            body: { ...values, reason: values.reason.trim() },
          }),
        );
        form.reset();
        onDone(result.regeneration);
      } catch (error) {
        setFailure(describeError(error));
      }
    },
  });
  return (
    <form
      className={`card ${styles.addCard}`}
      onSubmit={form.submit}
      noValidate
      aria-label={`Agregar día sin servicio a ${period.name}`}
    >
      <div>
        <h2 className={styles.cardTitle}>Agregar días sin servicio</h2>
        <p className={styles.cardLead}>
          {period.active
            ? 'Un día o un rango de fechas dentro del periodo activo.'
            : 'Un día o un rango de fechas dentro de este periodo.'}
        </p>
      </div>
      {failure && <Notice kind="error">{failure}</Notice>}
      <DateRangePicker
        fromLabel="Desde"
        toLabel="Hasta"
        from={form.values.from}
        to={form.values.to}
        onChange={(range) => {
          form.setValue('from', range.from);
          form.setValue('to', range.to);
          form.blur('from');
          form.blur('to');
        }}
        bounds={{ start: period.startDate, end: period.endDate }}
        closedDays={period.exceptions}
        shortcuts={['today', 'period', 'clear']}
        fromError={form.errors.from}
        toError={form.errors.to}
      />
      <TextField
        label="Motivo"
        value={form.values.reason}
        onChange={(v) => form.setValue('reason', v)}
        onBlur={() => form.blur('reason')}
        error={form.errors.reason}
        maxLength={200}
      />
      <SubmitButton busy={form.submitting}>
        Agregar día sin servicio
      </SubmitButton>
    </form>
  );
}

type Confirm =
  | { kind: 'delete-period'; period: Period }
  | { kind: 'delete-exception'; period: Period; id: string; label: string };

export function Periodos() {
  const periods = useResource(
    (signal) => call(getApi().client.GET('/periods', { signal })),
    [],
  );
  const [mode, setMode] = useState<'none' | 'new' | { edit: Period }>('none');
  const [result, setResult] = useState<Regeneration | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<Regeneration | void>) => {
    setBusy(true);
    setFailure(null);
    try {
      const regeneration = await action();
      setResult(regeneration ?? null);
      periods.reload();
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const toggle = (period: Period) =>
    run(async () => {
      const path = period.active
        ? '/periods/{id}/deactivate'
        : '/periods/{id}/activate';
      const updated = await call(
        getApi().client.POST(path, { params: { path: { id: period.id } } }),
      );
      return updated.regeneration ?? undefined;
    });

  const today = bogotaDay(new Date());

  return (
    <div>
      <PageHeader
        crumb="Periodos"
        title="Periodos"
        lead="Un periodo agrupa los horarios semanales de un semestre. Solo uno puede estar activo; los días sin servicio (festivos, semana santa) no generan sesiones."
        aside={
          mode === 'none' ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setMode('new')}
            >
              <Icon name="mas" size={17} strokeWidth={2} />
              Nuevo periodo
            </button>
          ) : undefined
        }
      />
      <div className={styles.main}>
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
        {mode === 'new' && (
          <PeriodForm
            initial={{ name: '', startDate: '', endDate: '' }}
            submitLabel="Crear periodo"
            onCancel={() => setMode('none')}
            onSubmit={async (values) => {
              await call(getApi().client.POST('/periods', { body: values }));
              setMode('none');
              periods.reload();
            }}
          />
        )}
        {typeof mode === 'object' && (
          <PeriodForm
            key={mode.edit.id}
            initial={{
              name: mode.edit.name,
              startDate: mode.edit.startDate,
              endDate: mode.edit.endDate,
            }}
            submitLabel="Guardar cambios"
            onCancel={() => setMode('none')}
            onSubmit={async (values) => {
              const edit = mode.edit;
              const updated = await call(
                getApi().client.PATCH('/periods/{id}', {
                  params: { path: { id: edit.id } },
                  body: values,
                }),
              );
              setMode('none');
              setResult(updated.regeneration ?? null);
              periods.reload();
            }}
          />
        )}

        {periods.loading && !periods.data && <Spinner />}
        {periods.error ? (
          <Notice kind="error">{describeError(periods.error)}</Notice>
        ) : null}
        {periods.data?.length === 0 && (
          <p className="muted">Todavía no hay periodos.</p>
        )}
        {periods.data?.map((period) => {
          const timeline = periodTimeline(period, today);
          return (
            <div key={period.id} className={styles.block}>
              <div className={styles.left}>
                <section
                  className={`card ${styles.periodCard}`}
                  aria-label={`Periodo ${period.name}`}
                >
                  <div className={styles.titleRow}>
                    <h2 className={styles.periodName}>{period.name}</h2>
                    <Badge tone={period.active ? 'mint' : 'neutral'}>
                      {period.active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </div>
                  <p className={styles.dates}>
                    Del {formatDay(period.startDate)} al{' '}
                    {formatDay(period.endDate)} · {period.schedulesCount}{' '}
                    horario(s)
                  </p>
                  <div className={styles.timeline}>
                    <div className={styles.track}>
                      <div
                        className={
                          timeline.progress >= 100
                            ? `${styles.fill} ${styles.fillFull}`
                            : styles.fill
                        }
                        style={{ width: `${timeline.progress}%` }}
                      />
                      {timeline.marks.map((mark) => (
                        <div
                          key={mark.id}
                          title={mark.title}
                          className={
                            mark.width === null ? styles.tick : styles.span
                          }
                          style={{
                            left: `${mark.left}%`,
                            ...(mark.width !== null
                              ? { width: `${mark.width}%` }
                              : {}),
                          }}
                        />
                      ))}
                      {timeline.todayAt !== null && (
                        <div
                          title="Hoy"
                          className={styles.today}
                          style={{ left: `${timeline.todayAt}%` }}
                        />
                      )}
                    </div>
                    <div className={styles.labels}>
                      <span>{formatShortDay(period.startDate)}</span>
                      {timeline.todayAt !== null ? (
                        <span className={styles.now}>
                          Hoy · {formatShortDay(today)}
                        </span>
                      ) : (
                        <span />
                      )}
                      <span>{formatShortDay(period.endDate)}</span>
                    </div>
                  </div>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className="btn"
                      disabled={busy}
                      onClick={() => void toggle(period)}
                    >
                      {period.active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setMode({ edit: period })}
                    >
                      Editar fechas
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-danger"
                      onClick={() =>
                        setConfirm({ kind: 'delete-period', period })
                      }
                    >
                      Eliminar
                    </button>
                  </div>
                </section>

                <section
                  className={`card ${styles.daysCard}`}
                  aria-label="Días sin servicio"
                >
                  <h2 className={styles.cardTitle}>Días sin servicio</h2>
                  {period.exceptions.length === 0 ? (
                    <p className={`muted ${styles.none}`}>
                      No hay días sin servicio.
                    </p>
                  ) : (
                    <ul className={styles.list}>
                      {period.exceptions.map((exception) => {
                        const label =
                          exception.from === exception.to
                            ? formatDay(exception.from)
                            : `${formatDay(exception.from)} al ${formatDay(exception.to)}`;
                        return (
                          <li key={exception.id} className={styles.exception}>
                            <span aria-hidden="true" className={styles.dot}>
                              <Icon name="horarios" />
                            </span>
                            <div className={styles.exceptionText}>
                              <div className={styles.reason}>
                                {exception.reason}
                              </div>
                              <div className={styles.when}>{label}</div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-s"
                              aria-label={`Quitar día sin servicio ${label}`}
                              onClick={() =>
                                setConfirm({
                                  kind: 'delete-exception',
                                  period,
                                  id: exception.id,
                                  label,
                                })
                              }
                            >
                              Quitar
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>
              <ExceptionForm
                period={period}
                onDone={(regeneration) => {
                  setResult(regeneration);
                  periods.reload();
                }}
              />
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === 'delete-period'
            ? 'Eliminar periodo'
            : 'Quitar día sin servicio'
        }
        tone="danger"
        confirmLabel={confirm?.kind === 'delete-period' ? 'Eliminar' : 'Quitar'}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'delete-period') {
            const { period } = confirm;
            void run(async () => {
              await call(
                getApi().client.DELETE('/periods/{id}', {
                  params: { path: { id: period.id } },
                }),
              );
            });
          } else {
            const { period, id } = confirm;
            void run(() =>
              call(
                getApi().client.DELETE(
                  '/periods/{id}/exceptions/{exceptionId}',
                  {
                    params: { path: { id: period.id, exceptionId: id } },
                  },
                ),
              ),
            );
          }
        }}
      >
        {confirm?.kind === 'delete-period' ? (
          <p>
            Se eliminará el periodo «{confirm.period.name}». Solo es posible si
            no tiene horarios.
          </p>
        ) : confirm ? (
          <p>
            Se quitará «{confirm.label}»: las sesiones de esos días se crearán
            de nuevo.
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
