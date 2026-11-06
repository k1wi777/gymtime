'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { Notice } from '@/ui/Notice';
import type { ReportKind, ReportQuery } from './report-query';

interface Props {
  kind: ReportKind;
  /** Filters and grouping in force; the same ones the screen shows. */
  query: ReportQuery;
  /** Order of the table on screen, so the file comes out in that order. */
  sort: { key: string; dir: 'asc' | 'desc' } | null;
  /** The range shown, to name the file. */
  range: { from: string; to: string };
  disabled?: boolean;
}

export const exportFilename = (
  kind: string,
  from: string,
  to: string,
): string => `reporte-${kind}-${from}_${to}.csv`;

/** Saves a blob as a file through a temporary link (nothing is kept in the page). */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * "Exportar CSV": warns that the file holds personal data (Ley 1581), then
 * downloads it with the filters and the order on screen. The server writes the
 * export to the audit trail before it answers.
 */
export function ExportButton({ kind, query, sort, range, disabled }: Props) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const blob = await call(
        getApi().client.GET('/reports/{kind}/export', {
          params: {
            path: { kind },
            query: {
              ...query,
              ...(sort ? { sort: sort.key, dir: sort.dir } : {}),
            },
          },
          parseAs: 'blob',
        }),
      );
      download(blob as Blob, exportFilename(kind, range.from, range.to));
      setAsking(false);
    } catch (error) {
      setAsking(false);
      setFailure(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled}
        onClick={() => {
          setFailure(null);
          setAsking(true);
        }}
      >
        Exportar CSV
      </button>
      <ConfirmDialog
        open={asking}
        title="Exportar a CSV"
        confirmLabel="Descargar el archivo"
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => setAsking(false)}
      >
        <p>
          El archivo contiene <strong>datos personales</strong> de los
          estudiantes (nombres, asistencia y tiempos). Guárdelo solo donde sea
          necesario, no lo comparta y elimínelo cuando termine de usarlo (Ley
          1581 de 2012). La exportación queda registrada en la auditoría.
        </p>
      </ConfirmDialog>
      {failure && (
        <Notice kind="error" title="No se pudo exportar">
          {failure}
        </Notice>
      )}
    </>
  );
}
