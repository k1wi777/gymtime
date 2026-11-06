'use client';

import { useEffect, useState } from 'react';
import { call, getApi } from '@/api/client';
import type { ReportOptions } from '@/api/types';
import { SelectField, TextField } from '@/ui/Form';
import { Notice } from '@/ui/Notice';
import {
  GROUP_LABELS,
  GROUPINGS,
  IGNORES_PERSON_FILTERS,
  rangeProblem,
  type Filters,
  type GroupBy,
  type ReportKind,
} from './report-query';
import styles from './Reportes.module.css';

interface Props {
  kind: ReportKind;
  options: ReportOptions;
  filters: Filters;
  groupBy: GroupBy;
  onFilters: (filters: Filters) => void;
  onGroupBy: (groupBy: GroupBy) => void;
}

interface Match {
  id: string;
  name: string;
  program: string | null;
}

/** Student picker: searches by name or document, shows names only. */
function StudentPicker({
  studentId,
  onPick,
}: {
  studentId: string;
  onPick: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    const query = text.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      call(
        getApi().client.GET('/panel/students', {
          params: { query: { search: query, limit: 8 } },
          signal: controller.signal,
        }),
      )
        .then((page) => {
          if (controller.signal.aborted) return;
          setMatches(
            page.items.map((s) => ({
              id: s.id,
              name: s.name,
              program: s.program ?? null,
            })),
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) setMatches([]);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  if (studentId) {
    return (
      <div className="stack">
        <span>Estudiante</span>
        <div className="row">
          <strong>{chosen ?? 'Estudiante elegido'}</strong>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setChosen(null);
              onPick('');
            }}
          >
            Quitar estudiante
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      <TextField
        label="Buscar estudiante"
        value={text}
        onChange={setText}
        help="Nombre o documento (mínimo 2 letras)"
        maxLength={60}
      />
      {text.trim().length >= 2 && matches.length > 0 && (
        <ul className={styles.matches} aria-label="Resultados de la búsqueda">
          {matches.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setChosen(m.name);
                  setText('');
                  setMatches([]);
                  onPick(m.id);
                }}
              >
                {m.name}
                {m.program ? ` · ${m.program}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function FiltrosReporte({
  kind,
  options,
  filters,
  groupBy,
  onFilters,
  onGroupBy,
}: Props) {
  const set = (patch: Partial<Filters>) => onFilters({ ...filters, ...patch });
  const problem = rangeProblem(filters, options.maxRangeDays);
  const groupings = GROUPINGS[kind];
  const person = !IGNORES_PERSON_FILTERS.includes(kind);
  const bad = (v: string) => v !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(v);

  return (
    <form
      className={`card ${styles.filters}`}
      aria-label="Filtros del reporte"
      onSubmit={(event) => event.preventDefault()}
      noValidate
    >
      <TextField
        label="Desde"
        value={filters.from}
        onChange={(from) => set({ from })}
        help={`AAAA-MM-DD (por defecto ${options.defaultRange.from})`}
        error={bad(filters.from) ? 'Use AAAA-MM-DD.' : undefined}
        maxLength={10}
      />
      <TextField
        label="Hasta"
        value={filters.to}
        onChange={(to) => set({ to })}
        help={`AAAA-MM-DD (por defecto ${options.defaultRange.to})`}
        error={bad(filters.to) ? 'Use AAAA-MM-DD.' : undefined}
        maxLength={10}
      />
      <SelectField
        label="Horario"
        value={filters.scheduleId}
        onChange={(scheduleId) => set({ scheduleId })}
        placeholder="Todos los horarios"
        options={options.schedules.map((s) => ({
          value: s.id,
          label: `${s.name} (${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)})`,
        }))}
      />
      {person && (
        <SelectField
          label="Programa"
          value={filters.program}
          onChange={(program) => set({ program })}
          placeholder="Todos los programas"
          options={options.programs.map((p) => ({ value: p, label: p }))}
        />
      )}
      {person && (
        <StudentPicker
          studentId={filters.studentId}
          onPick={(studentId) => set({ studentId })}
        />
      )}
      {groupings && (
        <SelectField
          label="Agrupar"
          value={groupBy}
          onChange={(value) => onGroupBy(value as GroupBy)}
          options={groupings.map((g) => ({ value: g, label: GROUP_LABELS[g] }))}
        />
      )}
      {problem && <Notice kind="error">{problem}</Notice>}
    </form>
  );
}
