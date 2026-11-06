'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError, issuesByField } from '@/api/errors';
import { useLive } from '@/live/live-provider';
import type { CommandEntry } from '@/live/reducers';
import {
  DISPLAY_LINE_MAX,
  DISPLAY_LINES,
  displayLineHelp,
} from '@/lib/display';
import { COMMAND_STATUS_LABELS, commandTypeLabel } from '@/lib/labels';
import { formatTimeSeconds } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import { validateMessage } from '@/lib/validators';
import { useLiveEvents, useResync } from '@/live/live-provider';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SubmitButton, TextField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { ALARM_REASON_LABELS } from '@/lib/labels';
import { DataTable, type Column } from '@/ui/DataTable';

const STATUS_TONE: Record<CommandEntry['status'], BadgeTone> = {
  pending: 'neutral',
  sent: 'info',
  acked: 'success',
  failed: 'danger',
};

/** Orders the assistant gives: only these appear in the recent-orders table. */
const SHOWN_TYPES = new Set(['alarm.set', 'display.message']);

function AlarmControls() {
  const status = useResource(
    (signal) => call(getApi().client.GET('/alarm/status', { signal })),
    [],
  );
  useLiveEvents((event) => {
    if (event.type === 'alarm') status.reload();
  });
  useResync(status.reload);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);

  const run = async (
    action: () => Promise<unknown>,
    done: string,
  ): Promise<void> => {
    setBusy(true);
    setFailure(null);
    setNote(null);
    try {
      await action();
      setNote(done);
      status.reload();
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
      setConfirmOff(false);
    }
  };

  const alarm = status.data;
  return (
    <section className="card stack" aria-label="Alarma">
      <h2>Alarma</h2>
      <p>
        Estado:{' '}
        {alarm ? (
          alarm.on ? (
            <Badge tone="danger">
              Sonando ·{' '}
              {ALARM_REASON_LABELS[alarm.reason ?? 'MANUAL'] ?? 'Alarma'}
            </Badge>
          ) : (
            <Badge tone="success">Apagada</Badge>
          )
        ) : (
          '…'
        )}
      </p>
      {failure && <Notice kind="error">{failure}</Notice>}
      {note && <Notice kind="success">{note}</Notice>}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void run(
              () => call(getApi().client.POST('/alarm/on')),
              'Orden de encender la alarma enviada.',
            )
          }
        >
          Encender alarma
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() =>
            void run(
              () => call(getApi().client.POST('/alarm/test')),
              'Orden de prueba enviada: sonará un pitido corto.',
            )
          }
        >
          Probar alarma
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy || !alarm?.on}
          onClick={() => setConfirmOff(true)}
        >
          Apagar alarma
        </button>
      </div>
      <ConfirmDialog
        open={confirmOff}
        title="¿Apagar la alarma?"
        tone="danger"
        confirmLabel="Apagar alarma"
        busy={busy}
        onConfirm={() =>
          void run(async () => {
            const result = await call(getApi().client.POST('/alarm/off'));
            return result;
          }, 'Alarma apagada.')
        }
        onCancel={() => setConfirmOff(false)}
      >
        <p>
          {alarm && alarm.openSessions > 0
            ? `Hay ${alarm.openSessions} sesión(es) abierta(s): se cerrarán como «no registrada».`
            : 'Se silenciará la sirena del lector.'}
        </p>
      </ConfirmDialog>
    </section>
  );
}

function MessageForm() {
  const [failure, setFailure] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const form = useForm({
    initial: { line1: '', line2: '' },
    validate: validateMessage,
    onSubmit: async (values) => {
      setFailure(null);
      setNote(null);
      try {
        const result = await call(
          getApi().client.POST('/devices/messages', {
            body: {
              line1: values.line1,
              ...(values.line2.trim() !== '' ? { line2: values.line2 } : {}),
            },
          }),
        );
        setNote(
          result.status === 'queued'
            ? 'El lector está fuera de línea: el mensaje se mostrará cuando se conecte.'
            : result.status === 'failed'
              ? 'El lector no confirmó el mensaje.'
              : 'Mensaje mostrado en el lector.',
        );
      } catch (error) {
        form.setServerErrors(issuesByField(error));
        setFailure(describeError(error));
      }
    },
  });
  const lines = ['line1', 'line2'] as const;
  return (
    <form
      className="card stack"
      onSubmit={form.submit}
      noValidate
      aria-label="Mensaje en pantalla"
    >
      <h2>Mensaje en la pantalla del lector</h2>
      <p className="muted">
        {DISPLAY_LINES} líneas. {displayLineHelp}
      </p>
      {failure && <Notice kind="error">{failure}</Notice>}
      {note && (
        <Notice kind={note.startsWith('El lector no') ? 'warning' : 'success'}>
          {note}
        </Notice>
      )}
      {lines.map((key, index) => (
        <TextField
          key={key}
          label={`Línea ${index + 1}${index === 0 ? ' (obligatoria)' : ''}`}
          value={form.values[key]}
          onChange={(value) => form.setValue(key, value)}
          onBlur={() => form.blur(key)}
          error={form.errors[key]}
          help={`${form.values[key].length}/${DISPLAY_LINE_MAX} caracteres`}
        />
      ))}
      <div>
        <SubmitButton busy={form.submitting}>Enviar mensaje</SubmitButton>
      </div>
    </form>
  );
}

export function Ordenes() {
  const { commands } = useLive();
  const rows = commands.filter((command) =>
    SHOWN_TYPES.has(command.commandType),
  );
  const columns: Column<CommandEntry>[] = [
    { key: 'at', header: 'Hora', render: (c) => formatTimeSeconds(c.at) },
    {
      key: 'type',
      header: 'Orden',
      render: (c) => commandTypeLabel(c.commandType),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (c) => (
        <Badge tone={STATUS_TONE[c.status]}>
          {COMMAND_STATUS_LABELS[c.status]}
        </Badge>
      ),
    },
    { key: 'attempts', header: 'Intentos', render: (c) => c.attempts },
  ];
  return (
    <div className="stack">
      <h1>Alarma y mensajes</h1>
      <div className="grid-3">
        <AlarmControls />
        <MessageForm />
      </div>
      <section className="stack" aria-label="Órdenes recientes">
        <h2>Órdenes recientes</h2>
        <p className="muted">
          Estado de cada orden según informa el lector (se muestran las últimas
          desde que abrió el panel).
        </p>
        <DataTable
          caption="Órdenes recientes"
          columns={columns}
          rows={rows}
          rowKey={(c) => c.commandId}
          emptyMessage="Todavía no hay órdenes."
        />
      </section>
    </div>
  );
}
