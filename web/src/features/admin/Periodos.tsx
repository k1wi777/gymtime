'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { Period, Regeneration } from '@/api/types';
import { formatDay } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { Badge } from '@/ui/Badge';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SubmitButton, TextField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import type { FieldErrors } from '@/lib/validators';
import { RegenerationNotice } from './RegenerationNotice';

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

function DateField({
  label,
  value,
  onChange,
  onBlur,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error: string | undefined;
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      error={error}
      help="Formato AAAA-MM-DD"
      maxLength={10}
    />
  );
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
      className="card stack"
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
      <DateField
        label="Primer día"
        value={form.values.startDate}
        onChange={(v) => form.setValue('startDate', v)}
        onBlur={() => form.blur('startDate')}
        error={form.errors.startDate}
      />
      <DateField
        label="Último día"
        value={form.values.endDate}
        onChange={(v) => form.setValue('endDate', v)}
        onBlur={() => form.blur('endDate')}
        error={form.errors.endDate}
      />
      <div className="row">
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
      className="stack"
      onSubmit={form.submit}
      noValidate
      aria-label={`Agregar día sin servicio a ${period.name}`}
    >
      <h3>Agregar días sin servicio</h3>
      {failure && <Notice kind="error">{failure}</Notice>}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <DateField
          label="Desde"
          value={form.values.from}
          onChange={(v) => form.setValue('from', v)}
          onBlur={() => form.blur('from')}
          error={form.errors.from}
        />
        <DateField
          label="Hasta"
          value={form.values.to}
          onChange={(v) => form.setValue('to', v)}
          onBlur={() => form.blur('to')}
          error={form.errors.to}
        />
        <TextField
          label="Motivo"
          value={form.values.reason}
          onChange={(v) => form.setValue('reason', v)}
          onBlur={() => form.blur('reason')}
          error={form.errors.reason}
          maxLength={200}
        />
      </div>
      <div>
        <SubmitButton busy={form.submitting}>
          Agregar día sin servicio
        </SubmitButton>
      </div>
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

  return (
    <div className="stack">
      <h1>Periodos</h1>
      <p className="muted">
        Un periodo agrupa los horarios semanales de un semestre. Solo uno puede
        estar activo; los días sin servicio (festivos, semana santa) no generan
        sesiones.
      </p>
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}
      {result && (
        <RegenerationNotice result={result} onDismiss={() => setResult(null)} />
      )}
      {mode === 'none' && (
        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMode('new')}
          >
            Nuevo periodo
          </button>
        </div>
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
      {periods.data?.map((period) => (
        <section
          key={period.id}
          className="card stack"
          aria-label={`Periodo ${period.name}`}
        >
          <div className="row">
            <h2>{period.name}</h2>
            <Badge tone={period.active ? 'success' : 'neutral'}>
              {period.active ? 'Activo' : 'Inactivo'}
            </Badge>
          </div>
          <p>
            Del {formatDay(period.startDate)} al {formatDay(period.endDate)} ·{' '}
            {period.schedulesCount} horario(s)
          </p>
          <div className="row">
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
              className="btn btn-danger"
              onClick={() => setConfirm({ kind: 'delete-period', period })}
            >
              Eliminar
            </button>
          </div>
          <h3>Días sin servicio</h3>
          {period.exceptions.length === 0 ? (
            <p className="muted">No hay días sin servicio.</p>
          ) : (
            <ul>
              {period.exceptions.map((exception) => {
                const label =
                  exception.from === exception.to
                    ? formatDay(exception.from)
                    : `${formatDay(exception.from)} al ${formatDay(exception.to)}`;
                return (
                  <li key={exception.id}>
                    {label}: {exception.reason}{' '}
                    <button
                      type="button"
                      className="btn"
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
          <ExceptionForm
            period={period}
            onDone={(regeneration) => {
              setResult(regeneration);
              periods.reload();
            }}
          />
        </section>
      ))}

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
