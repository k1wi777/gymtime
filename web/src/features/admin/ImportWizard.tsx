'use client';

import { useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type {
  ImportField,
  ImportPreview,
  ImportResult,
  InvalidRow,
} from '@/api/types';
import { apiUrl } from '@/lib/env';
import { Notice } from '@/ui/Notice';
import styles from './Admin.module.css';

type Mapping = Record<string, number | null>;

const STEPS = ['Archivo', 'Columnas', 'Vista previa', 'Resultado'] as const;
const MAX_SHOWN = 100;

/** The columns still unmapped among the required fields, by label. */
export function missingRequired(
  fields: readonly ImportField[],
  mapping: Mapping,
): string[] {
  return fields
    .filter((f) => f.required && mapping[f.key] == null)
    .map((f) => f.label);
}

function RowErrors({
  rows,
  fields,
}: {
  rows: readonly InvalidRow[];
  fields: readonly ImportField[];
}) {
  const label = (key: string | null) =>
    fields.find((f) => f.key === key)?.label ?? key ?? 'Fila';
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <caption className="visually-hidden">Filas con errores</caption>
        <thead>
          <tr>
            <th scope="col">Fila</th>
            <th scope="col">Problemas</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, MAX_SHOWN).map((row) => (
            <tr key={row.row}>
              <td>{row.row}</td>
              <td>
                {row.errors.map((e, i) => (
                  <div key={i}>
                    {label(e.field)}: {e.message}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_SHOWN && (
        <p className="muted">
          Se muestran las primeras {MAX_SHOWN} de {rows.length} filas con
          errores.
        </p>
      )}
    </div>
  );
}

/** Four steps: file, columns, preview with row errors, result (E20). */
export function ImportWizard({
  fields,
  onDone,
  onClose,
}: {
  fields: readonly ImportField[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [filename, setFilename] = useState('');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const pick = (file: File | undefined) =>
    run(async () => {
      if (!file) return;
      const text = await file.text();
      const parsed = await call(
        getApi().client.POST('/students/import/preview', {
          body: { content: text },
        }),
      );
      setFilename(file.name);
      setContent(text);
      setPreview(parsed);
      setMapping(parsed.suggestedMapping as Mapping);
      setStep(1);
    });

  const validate = () =>
    run(async () => {
      const parsed = await call(
        getApi().client.POST('/students/import/preview', {
          body: { content, mapping },
        }),
      );
      setPreview(parsed);
      setStep(2);
    });

  const confirm = () =>
    run(async () => {
      const done = await call(
        getApi().client.POST('/students/import', {
          body: { content, mapping, filename },
        }),
      );
      setResult(done);
      setStep(3);
      onDone();
    });

  const downloadTemplate = () =>
    run(async () => {
      const response = await fetch(`${apiUrl()}/students/import/template`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('template');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'plantilla-estudiantes.csv';
      link.click();
      URL.revokeObjectURL(url);
    });

  const missing = missingRequired(fields, mapping);
  const validation = preview?.validation;

  return (
    <section className="card stack" aria-label="Importar estudiantes">
      <h2>Importar estudiantes desde CSV</h2>
      <ol className={styles.wizardSteps} aria-label="Pasos">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {failure && <Notice kind="error">{failure}</Notice>}

      {step === 0 && (
        <div className="stack">
          <p>
            Suba un archivo CSV (coma o punto y coma, hasta 5000 filas). El
            documento y el nombre son obligatorios.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => void downloadTemplate()}
            >
              Descargar plantilla
            </button>
            <label>
              <span className="visually-hidden">Archivo CSV</span>
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                disabled={busy}
                onChange={(event) => void pick(event.target.files?.[0])}
              />
            </label>
          </div>
        </div>
      )}

      {step === 1 && preview && (
        <div className="stack">
          <p>
            Indique qué columna de «{filename}» corresponde a cada dato. Ya
            sugerimos una asignación.
          </p>
          {fields.map((field) => (
            <label key={field.key} className="stack" style={{ gap: '0.2rem' }}>
              <strong>
                {field.label}
                {field.required ? ' *' : ''}
              </strong>
              <select
                value={
                  mapping[field.key] == null ? '' : String(mapping[field.key])
                }
                onChange={(event) =>
                  setMapping({
                    ...mapping,
                    [field.key]:
                      event.target.value === ''
                        ? null
                        : Number(event.target.value),
                  })
                }
              >
                <option value="">No importar</option>
                {preview.headers.map((header, index) => (
                  <option key={index} value={index}>
                    {header || `Columna ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {missing.length > 0 && (
            <Notice kind="warning">
              Asigne una columna a: {missing.join(', ')}.
            </Notice>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep(0)}>
              Atrás
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || missing.length > 0}
              onClick={() => void validate()}
            >
              Ver vista previa
            </button>
          </div>
        </div>
      )}

      {step === 2 && validation && (
        <div className="stack">
          <p>
            Filas en el archivo: <strong>{validation.total}</strong> · válidas:{' '}
            <strong>{validation.valid}</strong> · con errores:{' '}
            <strong>{validation.invalidRows.length}</strong>
          </p>
          {validation.invalidRows.length > 0 && (
            <>
              <Notice kind="warning">
                Las filas con errores no se importarán; las válidas sí.
              </Notice>
              <RowErrors rows={validation.invalidRows} fields={fields} />
            </>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              Atrás
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || validation.valid === 0}
              onClick={() => void confirm()}
            >
              Importar {validation.valid} estudiante(s)
            </button>
          </div>
        </div>
      )}

      {step === 3 && result && (
        <div className="stack">
          <Notice kind="success" title="Importación terminada">
            Se crearon {result.created} de {result.total} filas.
            {result.invalidRows.length > 0 &&
              ` ${result.invalidRows.length} filas no se importaron.`}
          </Notice>
          {result.invalidRows.length > 0 && (
            <RowErrors rows={result.invalidRows} fields={fields} />
          )}
          <p className="muted">
            Los estudiantes importados quedan sin consentimiento ni huella:
            regístrelos desde la tabla.
          </p>
        </div>
      )}

      <div>
        <button type="button" className="btn" onClick={onClose}>
          {step === 3 ? 'Cerrar' : 'Cancelar importación'}
        </button>
      </div>
    </section>
  );
}
