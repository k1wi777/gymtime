'use client';

import { useEffect, useState } from 'react';
import { call, getApi } from '@/api/client';
import { describeError, issuesByField } from '@/api/errors';
import type { ImportField, PanelStudent, Student } from '@/api/types';
import { ConsentDialog } from '@/features/students/ConsentDialog';
import { formatDate } from '@/lib/time';
import { useResource } from '@/lib/use-resource';
import type { FieldErrors } from '@/lib/validators';
import { Badge } from '@/ui/Badge';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { SelectField, SubmitButton, TextField, useForm } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import { Spinner } from '@/ui/Spinner';
import { ImportWizard } from './ImportWizard';
import styles from './Admin.module.css';

const PAGE = 20;
const DISPLAY_MAX = 16;

type Values = Record<string, string>;

/** Early feedback from the field definitions the server publishes. */
export function validateStudent(
  fields: readonly ImportField[],
  creating: boolean,
) {
  return (values: Values): FieldErrors<Values> => {
    const errors: FieldErrors<Values> = {};
    for (const field of fields) {
      if (!creating && !field.editable) continue;
      const value = (values[field.key] ?? '').trim();
      if (field.required && value === '') errors[field.key] = 'Es obligatorio.';
      if (field.key === 'displayName' && value.length > DISPLAY_MAX) {
        errors[field.key] = `Admite hasta ${DISPLAY_MAX} caracteres.`;
      }
    }
    return errors;
  };
}

function StudentForm({
  fields,
  student,
  onSaved,
  onCancel,
}: {
  fields: readonly ImportField[];
  student: Student | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const creating = student === null;
  const [failure, setFailure] = useState<string | null>(null);
  const initial: Values = Object.fromEntries(
    fields.map((f) => {
      const current = (student as Record<string, unknown> | null)?.[f.key];
      return [f.key, typeof current === 'string' ? current : ''];
    }),
  );
  const form = useForm<Values>({
    initial,
    validate: validateStudent(fields, creating),
    onSubmit: async (values) => {
      setFailure(null);
      const body: Record<string, string> = {};
      for (const field of fields) {
        if (!creating && !field.editable) continue;
        const value = (values[field.key] ?? '').trim();
        if (value !== '') body[field.key] = value;
      }
      try {
        if (student) {
          await call(
            getApi().client.PATCH('/students/{id}', {
              params: { path: { id: student.id } },
              body,
            }),
          );
        } else {
          await call(
            getApi().client.POST('/students', {
              body: {
                ...(body as { document: string; name: string }),
                consented: false,
              },
            }),
          );
        }
        onSaved();
      } catch (error) {
        form.setServerErrors(issuesByField(error));
        setFailure(describeError(error));
      }
    },
  });
  return (
    <form
      className="card stack"
      onSubmit={form.submit}
      noValidate
      aria-label={creating ? 'Nuevo estudiante' : `Editar ${student.name}`}
    >
      <h2>{creating ? 'Nuevo estudiante' : `Editar ${student.name}`}</h2>
      {failure && <Notice kind="error">{failure}</Notice>}
      {fields.map((field) => (
        <TextField
          key={field.key}
          label={field.required ? `${field.label} *` : field.label}
          value={form.values[field.key] ?? ''}
          onChange={(v) => form.setValue(field.key, v)}
          onBlur={() => form.blur(field.key)}
          error={form.errors[field.key]}
          help={field.help || undefined}
          disabled={!creating && !field.editable}
        />
      ))}
      <div className="row">
        <SubmitButton busy={form.submitting}>
          {creating ? 'Crear estudiante' : 'Guardar cambios'}
        </SubmitButton>
        <button type="button" className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Estudiantes() {
  const fields = useResource(
    (signal) =>
      call(getApi().client.GET('/students/import/fields', { signal })),
    [],
  );
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [program, setProgram] = useState('');
  const [active, setActive] = useState('true');
  const [fingerprint, setFingerprint] = useState('');
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<
    'none' | 'new' | 'import' | { edit: Student }
  >('none');
  const [consentFor, setConsentFor] = useState<Student | null>(null);
  const [toDeactivate, setToDeactivate] = useState<Student | null>(null);
  const [toErase, setToErase] = useState<PanelStudent | null>(null);
  const [typedDocument, setTypedDocument] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const students = useResource(
    (signal) =>
      call(
        getApi().client.GET('/panel/students', {
          params: {
            query: {
              limit: PAGE,
              offset,
              ...(debounced ? { search: debounced } : {}),
              ...(program.trim() ? { program: program.trim() } : {}),
              ...(active ? { active: active as 'true' | 'false' } : {}),
              ...(fingerprint
                ? { fingerprint: fingerprint as 'none' | 'enrolled' }
                : {}),
            },
          },
          signal,
        }),
      ),
    [debounced, program, active, fingerprint, offset],
  );

  const deactivate = async () => {
    if (!toDeactivate) return;
    setBusy(true);
    setFailure(null);
    try {
      await call(
        getApi().client.DELETE('/students/{id}', {
          params: { path: { id: toDeactivate.id } },
        }),
      );
      students.reload();
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
      setToDeactivate(null);
    }
  };

  const erase = async () => {
    if (!toErase) return;
    setBusy(true);
    setFailure(null);
    try {
      await call(
        getApi().client.POST('/students/{id}/erase', {
          params: { path: { id: toErase.id } },
          body: { confirmDocument: typedDocument.trim() },
        }),
      );
      students.reload();
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
      setToErase(null);
      setTypedDocument('');
    }
  };

  const total = students.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const page = Math.floor(offset / PAGE) + 1;

  return (
    <div className="stack">
      <h1>Estudiantes</h1>
      {failure && (
        <Notice kind="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Notice>
      )}
      {mode === 'none' && fields.data && (
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setMode('new')}
          >
            Nuevo estudiante
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setMode('import')}
          >
            Importar CSV
          </button>
        </div>
      )}
      {fields.error ? (
        <Notice kind="error">{describeError(fields.error)}</Notice>
      ) : null}
      {mode === 'new' && fields.data && (
        <StudentForm
          fields={fields.data}
          student={null}
          onCancel={() => setMode('none')}
          onSaved={() => {
            setMode('none');
            students.reload();
          }}
        />
      )}
      {typeof mode === 'object' && fields.data && (
        <StudentForm
          key={mode.edit.id}
          fields={fields.data}
          student={mode.edit}
          onCancel={() => setMode('none')}
          onSaved={() => {
            setMode('none');
            students.reload();
          }}
        />
      )}
      {mode === 'import' && fields.data && (
        <ImportWizard
          fields={fields.data}
          onDone={students.reload}
          onClose={() => setMode('none')}
        />
      )}

      <div className={styles.filters}>
        <TextField
          label="Buscar por nombre o documento"
          type="search"
          value={search}
          onChange={setSearch}
        />
        <TextField
          label="Carrera"
          value={program}
          onChange={(v) => {
            setProgram(v);
            setOffset(0);
          }}
        />
        <SelectField
          label="Estado"
          value={active}
          onChange={(v) => {
            setActive(v);
            setOffset(0);
          }}
          options={[
            { value: '', label: 'Todos' },
            { value: 'true', label: 'Activos' },
            { value: 'false', label: 'De baja' },
          ]}
        />
        <SelectField
          label="Huella"
          value={fingerprint}
          onChange={(v) => {
            setFingerprint(v);
            setOffset(0);
          }}
          options={[
            { value: '', label: 'Todas' },
            { value: 'none', label: 'Sin huella' },
            { value: 'enrolled', label: 'Con huella' },
          ]}
        />
      </div>

      {students.loading && !students.data && <Spinner />}
      {students.error ? (
        <Notice kind="error">{describeError(students.error)}</Notice>
      ) : null}
      {students.data && (
        <>
          <p className="muted">{total} estudiante(s)</p>
          <div className={styles.scroll}>
            <table className={styles.table}>
              <caption className="visually-hidden">Estudiantes</caption>
              <thead>
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Documento</th>
                  <th scope="col">Carrera</th>
                  <th scope="col">Huella</th>
                  <th scope="col">Consentimiento</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {students.data.items.map((s: PanelStudent) => (
                  <tr key={s.id}>
                    <td>
                      {s.name}{' '}
                      {s.anonymizedAt ? (
                        <Badge tone="warning">Datos suprimidos</Badge>
                      ) : (
                        !s.active && <Badge tone="warning">De baja</Badge>
                      )}
                    </td>
                    <td>{s.document}</td>
                    <td>{s.program ?? '—'}</td>
                    <td>
                      {s.fingerprintEnrolledAt ? (
                        <Badge tone="success">Con huella</Badge>
                      ) : (
                        <Badge>Sin huella</Badge>
                      )}
                    </td>
                    <td>
                      {s.consented ? (
                        <Badge tone="success">
                          {s.consentVersion}
                          {s.consentAt ? ` · ${formatDate(s.consentAt)}` : ''}
                        </Badge>
                      ) : (
                        <Badge tone="warning">Falta</Badge>
                      )}
                    </td>
                    <td>
                      <div className="row">
                        {!s.consented && s.active && (
                          <button
                            type="button"
                            className="btn"
                            aria-label={`Registrar consentimiento de ${s.name}`}
                            onClick={() => setConsentFor(s)}
                          >
                            Consentimiento
                          </button>
                        )}
                        {!s.anonymizedAt && (
                          <button
                            type="button"
                            className="btn"
                            aria-label={`Editar a ${s.name}`}
                            onClick={() => setMode({ edit: s })}
                          >
                            Editar
                          </button>
                        )}
                        {s.active && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            aria-label={`Dar de baja a ${s.name}`}
                            onClick={() => setToDeactivate(s)}
                          >
                            Dar de baja
                          </button>
                        )}
                        {!s.anonymizedAt && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            aria-label={`Suprimir datos de ${s.name}`}
                            onClick={() => setToErase(s)}
                          >
                            Suprimir datos
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {students.data.items.length === 0 && (
            <p className="muted">No hay estudiantes con esos filtros.</p>
          )}
          {pages > 1 && (
            <nav className="row" aria-label="Paginación">
              <button
                type="button"
                className="btn"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                Anterior
              </button>
              <span>
                Página {page} de {pages}
              </span>
              <button
                type="button"
                className="btn"
                disabled={page >= pages}
                onClick={() => setOffset(offset + PAGE)}
              >
                Siguiente
              </button>
            </nav>
          )}
        </>
      )}

      <ConsentDialog
        student={consentFor}
        onClose={() => setConsentFor(null)}
        onRecorded={() => {
          setConsentFor(null);
          students.reload();
        }}
      />
      <ConfirmDialog
        open={toDeactivate !== null}
        title="Dar de baja"
        tone="danger"
        confirmLabel="Dar de baja"
        busy={busy}
        onCancel={() => setToDeactivate(null)}
        onConfirm={() => void deactivate()}
      >
        <p>
          «{toDeactivate?.name}» dejará de poder entrar al gimnasio. Su
          historial se conserva.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={toErase !== null}
        title="Suprimir datos personales"
        tone="danger"
        confirmLabel="Suprimir datos"
        busy={busy}
        confirmDisabled={typedDocument.trim() !== (toErase?.document ?? '')}
        onCancel={() => {
          setToErase(null);
          setTypedDocument('');
        }}
        onConfirm={() => void erase()}
      >
        <div className="stack">
          <p>
            Se borrarán de forma <strong>irreversible</strong> el nombre, el
            documento, los datos de contacto y la huella de «{toErase?.name}».
            La huella saldrá del lector en la siguiente sincronización. Las
            asistencias y los reportes se conservan sin identificar a la
            persona.
          </p>
          <TextField
            label="Escriba el documento para confirmar"
            value={typedDocument}
            onChange={setTypedDocument}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
