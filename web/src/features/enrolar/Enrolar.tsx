'use client';

import { useSearchParams } from 'next/navigation';
import { Fragment, useEffect, useRef, useState } from 'react';
import { call, getApi } from '@/api/client';
import type { Student } from '@/api/types';
import { useResync } from '@/live/live-provider';
import { useResource } from '@/lib/use-resource';
import { Badge } from '@/ui/Badge';
import { DataTable, type Column, type SelectFilter } from '@/ui/DataTable';
import { Icon } from '@/ui/icons';
import { PageHeader } from '@/ui/PageHeader';
import { EnrollPanel } from './EnrollPanel';
import styles from './Enrolar.module.css';

export function Enrolar() {
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
  const fingerprints = useResource(
    (signal) => call(getApi().client.GET('/panel/fingerprints', { signal })),
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // `?estudiante=<id>` (from the card in «Ahora») chooses the student once;
  // an unknown or inactive id is ignored.
  const preselect = useSearchParams().get('estudiante');
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current || !preselect || !students.data) return;
    applied.current = true;
    if (students.data.some((s) => s.id === preselect)) {
      setSelectedId(preselect);
    }
  }, [preselect, students.data]);
  const [running, setRunning] = useState(false);
  useResync(() => {
    students.reload();
    fingerprints.reload();
  });

  const withFingerprint = new Set(fingerprints.data?.studentIds ?? []);
  const selected = students.data?.find((s) => s.id === selectedId);

  const columns: Column<Student>[] = [
    {
      key: 'name',
      header: 'Nombre',
      render: (s) => s.name,
      sortValue: (s) => s.name,
    },
    { key: 'document', header: 'Documento', render: (s) => s.document },
    {
      key: 'consent',
      header: 'Consentimiento',
      render: (s) =>
        s.consented ? (
          <Badge tone="success">Registrado</Badge>
        ) : (
          <Badge tone="warning">Falta</Badge>
        ),
    },
    {
      key: 'fingerprint',
      header: 'Huella',
      render: (s) =>
        withFingerprint.has(s.id) ? (
          <Badge tone="success">Con huella</Badge>
        ) : (
          <Badge tone="warning">Sin huella</Badge>
        ),
    },
    {
      key: 'action',
      header: 'Acción',
      render: (s) => (
        <button
          type="button"
          className="btn"
          disabled={running && s.id !== selectedId}
          onClick={() => setSelectedId(s.id)}
          aria-label={`Elegir a ${s.name}`}
        >
          Elegir
        </button>
      ),
    },
  ];

  const selects: SelectFilter<Student>[] = [
    {
      id: 'fingerprint',
      label: 'Huella',
      options: [
        { value: 'with', label: 'Con huella' },
        { value: 'without', label: 'Sin huella' },
      ],
      matches: (s, value) =>
        value === 'with'
          ? withFingerprint.has(s.id)
          : !withFingerprint.has(s.id),
    },
  ];

  const current = !selected ? 1 : !selected.consented ? 2 : 3;
  const STEPS = ['Elegir estudiante', 'Consentimiento', 'Poner la huella'];

  return (
    <>
      <PageHeader
        eyebrow="Asistente · Huellas"
        title="Enrolar huella"
        lead="Elija al estudiante y pídale que ponga el dedo en el lector cuando el panel lo indique."
      />
      <div className={styles.body}>
        <ol aria-label="Pasos" className={styles.stepper}>
          {STEPS.map((label, index) => {
            const number = index + 1;
            const state =
              number < current
                ? 'Done'
                : number === current
                  ? 'Current'
                  : 'Next';
            return (
              <Fragment key={label}>
                {index > 0 && (
                  <li
                    aria-hidden="true"
                    className={`${styles.bar} ${number <= current ? styles.barDone : ''}`}
                  />
                )}
                <li
                  className={styles.step}
                  aria-current={number === current ? 'step' : undefined}
                >
                  <span
                    className={`${styles.bullet} ${styles[`bullet${state}`]}`}
                  >
                    {state === 'Done' ? (
                      <Icon name="check" size={14} strokeWidth={2.8} />
                    ) : (
                      number
                    )}
                  </span>
                  <span className={styles[`stepLabel${state}`]}>{label}</span>
                </li>
              </Fragment>
            );
          })}
        </ol>
        {selected && (
          <div>
            <button
              type="button"
              className="btn"
              disabled={running}
              onClick={() => setSelectedId(null)}
            >
              Cambiar estudiante
            </button>
          </div>
        )}
        {selected && (
          <EnrollPanel
            key={selected.id}
            student={selected}
            hasFingerprint={withFingerprint.has(selected.id)}
            onStudentChanged={students.reload}
            onEnrollmentChanged={(isRunning) => {
              setRunning(isRunning);
              if (!isRunning) fingerprints.reload();
            }}
          />
        )}
        <div className={`card ${styles.tableCard}`}>
          <DataTable
            caption="Estudiantes"
            columns={columns}
            rows={students.data}
            rowKey={(s) => s.id}
            loading={students.loading}
            error={students.error}
            onRetry={students.reload}
            searchText={(s) => `${s.name} ${s.document}`}
            selects={selects}
            emptyMessage="No hay estudiantes que coincidan."
          />
        </div>
      </div>
    </>
  );
}
