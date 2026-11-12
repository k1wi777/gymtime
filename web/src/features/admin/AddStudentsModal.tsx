'use client';

import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { call, getApi } from '@/api/client';
import { describeError } from '@/api/errors';
import type { Schedule, Student } from '@/api/types';
import { StudentSearch } from '@/features/students/StudentSearch';
import { FormModal, useCloseRequest, useModalGuard } from '@/ui/FormModal';
import { useModalFooter } from '@/ui/Modal';
import { Icon } from '@/ui/icons';
import { Notice } from '@/ui/Notice';
import { parseDocuments } from './documents';
import styles from './AddStudentsModal.module.css';

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

/** Documents compare without dots, spaces or dashes («1.067.123» = «1067123»). */
const key = (document: string): string => document.replace(/[^0-9a-z]/gi, '');

interface Props {
  open: boolean;
  schedule: Schedule;
  /** Every student of the system; the inactive ones are never offered. */
  students: readonly Student[];
  onClose: () => void;
  /** The assignment went through: the caller reloads the schedules. */
  onAdded: () => void;
}

export function AddStudentsModal({
  open,
  schedule,
  students,
  onClose,
  onAdded,
}: Props) {
  return (
    <FormModal
      open={open}
      title="Agregar estudiantes"
      size="w600"
      description={`${schedule.name} · Busque uno o varios, o cargue un archivo.`}
      onClose={onClose}
    >
      <AddStudentsBody
        schedule={schedule}
        students={students}
        onAdded={onAdded}
        onDone={onClose}
      />
    </FormModal>
  );
}

function AddStudentsBody({
  schedule,
  students,
  onAdded,
  onDone,
}: {
  schedule: Schedule;
  students: readonly Student[];
  onAdded: () => void;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<Student[]>([]);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const footer = useModalFooter();
  const requestClose = useCloseRequest();
  // R13: leaving with people in «Para agregar» asks first.
  useModalGuard(picked.length > 0, busy);

  const assigned = useMemo(
    () => new Set(schedule.students.map((s) => s.id)),
    [schedule.students],
  );
  const active = useMemo(() => students.filter((s) => s.active), [students]);
  const inList = new Set(picked.map((s) => s.id));

  const toggle = (student: Student) =>
    setPicked((current) =>
      current.some((s) => s.id === student.id)
        ? current.filter((s) => s.id !== student.id)
        : [...current, student],
    );

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    const documents = parseDocuments(await file.text());
    const byDocument = new Map(students.map((s) => [key(s.document), s]));
    const add: Student[] = [];
    let notFound = 0;
    let inactive = 0;
    let already = 0;
    for (const document of documents) {
      const found = byDocument.get(key(document));
      if (!found) notFound += 1;
      else if (!found.active) inactive += 1;
      else if (assigned.has(found.id) || inList.has(found.id)) already += 1;
      else if (!add.some((s) => s.id === found.id)) add.push(found);
    }
    setPicked((current) => [...current, ...add]);
    const parts = [`${plural(add.length, 'agregado', 'agregados')} a la lista`];
    if (notFound)
      parts.push(
        `${notFound} no se ${notFound === 1 ? 'encontró' : 'encontraron'}`,
      );
    if (inactive) parts.push(`${inactive} de baja`);
    if (already)
      parts.push(
        `${plural(already, 'ya estaba', 'ya estaban')} en el horario o en la lista`,
      );
    setFileNote(`Del archivo «${file.name}»: ${parts.join(', ')}.`);
  };

  const submit = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await call(
        getApi().client.POST('/schedules/{id}/students/bulk', {
          params: { path: { id: schedule.id } },
          body: { documents: picked.map((s) => s.document) },
        }),
      );
      const rejected = new Set([
        ...result.notFound,
        ...result.inactive.map((s) => s.document),
      ]);
      onAdded();
      if (rejected.size === 0) {
        setPicked([]);
        onDone();
        return;
      }
      // A race with another user: keep only what did not go through.
      setPicked((current) => current.filter((s) => rejected.has(s.document)));
      setFailure(
        `No se pudo agregar a: ${[...rejected].join(', ')}. Revise la lista.`,
      );
    } catch (error) {
      setFailure(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const footerContent = (
    <div className="row">
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={requestClose ?? onDone}
      >
        Cancelar
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy || picked.length === 0}
        onClick={() => void submit()}
      >
        {busy
          ? 'Un momento…'
          : picked.length === 0
            ? 'Agregar'
            : `Agregar ${plural(picked.length, 'estudiante', 'estudiantes')}`}
      </button>
    </div>
  );

  return (
    <div className={styles.body}>
      {failure && <Notice kind="error">{failure}</Notice>}
      <div className={styles.top}>
        <div className={styles.search}>
          <StudentSearch
            variant="compact"
            students={active}
            ariaLabel="Buscar estudiante por nombre o cédula"
            statusOf={(student) =>
              assigned.has(student.id)
                ? { label: 'Ya está en este horario', disabled: true }
                : inList.has(student.id)
                  ? { label: 'En la lista ✓', on: true }
                  : { label: 'Agregar' }
            }
            onSelect={toggle}
          />
        </div>
        <button
          type="button"
          className={styles.file}
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="subir" size={15} strokeWidth={2} />
          Cargar desde archivo
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.csv,text/plain"
          hidden
          aria-label="Archivo con cédulas"
          data-testid="students-file"
          onChange={(event) => {
            void readFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>
      <section aria-label="Para agregar">
        <div className={styles.queueHead}>
          <h3 className={styles.queueTitle}>Para agregar ({picked.length})</h3>
          {picked.length > 0 && (
            <button
              type="button"
              className={styles.clear}
              onClick={() => {
                setPicked([]);
                setFileNote(null);
              }}
            >
              Vaciar lista
            </button>
          )}
        </div>
        {picked.length === 0 ? (
          <div className={styles.empty}>
            Aún no hay nadie. Elija estudiantes de la búsqueda o cargue un
            archivo.
          </div>
        ) : (
          <ul className={styles.chips}>
            {picked.map((student) => (
              <li key={student.id} className={styles.chip}>
                {student.name}
                <button
                  type="button"
                  aria-label={`Quitar a ${student.name} de la lista`}
                  onClick={() => toggle(student)}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {fileNote && <p className={styles.fileNote}>{fileNote}</p>}
      </section>
      {footer ? createPortal(footerContent, footer) : footerContent}
    </div>
  );
}
