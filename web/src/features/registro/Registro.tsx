'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError, issuesByField } from '@/api/errors';
import type { Student } from '@/api/types';
import { StudentPicker } from '@/features/students/StudentPicker';
import { formatTime } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { validateManual, REASON_MAX } from '@/lib/validators';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SubmitButton, TextAreaField, SelectField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';

type Kind = 'entry' | 'exit';
const KIND_LABELS: Record<Kind, string> = { entry: 'Entrada', exit: 'Salida' };

export function Registro() {
  const students = useResource(
    (signal) =>
      call(
        getApi().client.GET('/students', {
          params: { query: { active: 'true' } },
          signal,
        }),
      ),
    [],
  );
  const [kind, setKind] = useState<Kind>('entry');
  const [pending, setPending] = useState<{
    studentId: string;
    reason: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const form = useForm({
    initial: { studentId: '', reason: '' },
    validate: validateManual,
    // The summary is confirmed before anything is sent.
    onSubmit: (values) => {
      setFailure(null);
      setSuccess(null);
      setPending(values);
    },
  });

  const selected: Student | undefined = students.data?.find(
    (student) => student.id === pending?.studentId,
  );

  const send = async (): Promise<void> => {
    if (!pending) return;
    setBusy(true);
    try {
      const body = {
        studentId: pending.studentId,
        reason: pending.reason.trim(),
      };
      const { client } = getApi();
      const session =
        kind === 'entry'
          ? await call(client.POST('/attendance/entry', { body }))
          : await call(client.POST('/attendance/exit', { body }));
      setSuccess(
        kind === 'entry'
          ? `Entrada registrada para ${session.student.name} a las ${formatTime(session.enteredAt)}.`
          : `Salida registrada para ${session.student.name} a las ${formatTime(session.exitedAt ?? session.enteredAt)}.`,
      );
      form.reset();
    } catch (error) {
      form.setServerErrors(issuesByField(error));
      setFailure(describeError(error));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  return (
    <div className="stack">
      <h1>Registro manual</h1>
      <p className="muted">
        Para quien no pudo usar la huella. Queda anotado el motivo y quién lo
        registró.
      </p>
      {success && (
        <Notice kind="success" onDismiss={() => setSuccess(null)}>
          {success}
        </Notice>
      )}
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}
      {students.loading ? (
        <Spinner />
      ) : students.error ? (
        <Notice
          kind="error"
          title="No se pudo cargar la lista de estudiantes"
          actions={
            <button type="button" className="btn" onClick={students.reload}>
              Reintentar
            </button>
          }
        >
          {describeError(students.error)}
        </Notice>
      ) : (
        <form
          className="card stack"
          onSubmit={form.submit}
          noValidate
          style={{ maxWidth: '36rem' }}
        >
          <SelectField
            label="Operación"
            value={kind}
            onChange={(value) => setKind(value as Kind)}
            options={[
              { value: 'entry', label: 'Registrar entrada' },
              { value: 'exit', label: 'Registrar salida' },
            ]}
          />
          <StudentPicker
            students={students.data ?? []}
            value={form.values.studentId}
            onChange={(id) => form.setValue('studentId', id)}
            onBlur={() => form.blur('studentId')}
            error={form.errors.studentId}
          />
          <TextAreaField
            label="Motivo"
            help="Obligatorio. Por ejemplo: «el lector no reconoce la huella»."
            maxLength={REASON_MAX}
            value={form.values.reason}
            onChange={(value) => form.setValue('reason', value)}
            onBlur={() => form.blur('reason')}
            error={form.errors.reason}
          />
          <div>
            <SubmitButton busy={false}>
              Registrar {KIND_LABELS[kind].toLowerCase()}
            </SubmitButton>
          </div>
        </form>
      )}
      <ConfirmDialog
        open={pending !== null}
        title={`¿Registrar ${KIND_LABELS[kind].toLowerCase()} manual?`}
        confirmLabel="Registrar"
        busy={busy}
        onConfirm={() => void send()}
        onCancel={() => setPending(null)}
      >
        <p>
          <strong>{selected?.name}</strong> ({selected?.document})
        </p>
        <p>Motivo: {pending?.reason.trim()}</p>
      </ConfirmDialog>
    </div>
  );
}
