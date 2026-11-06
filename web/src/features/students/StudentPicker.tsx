'use client';

import { useId, useMemo, useState } from 'react';
import type { Student } from '@/api/types';

const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Props {
  students: readonly Student[];
  value: string;
  onChange: (studentId: string) => void;
  error?: string | undefined;
  onBlur?: () => void;
  label?: string;
}

/** Search box over a list box: the assistant types a name or document and picks. */
export function StudentPicker({
  students,
  value,
  onChange,
  error,
  onBlur,
  label = 'Estudiante',
}: Props) {
  const id = useId();
  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const needle = normalize(query.trim());
    return students.filter(
      (student) =>
        needle === '' ||
        normalize(`${student.name} ${student.document}`).includes(needle),
    );
  }, [students, query]);

  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <label htmlFor={`${id}-search`}>
        <strong>{label}</strong>
      </label>
      <input
        id={`${id}-search`}
        type="search"
        placeholder="Buscar por nombre o documento"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        style={{
          padding: '0.5rem 0.65rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      />
      <select
        id={`${id}-list`}
        aria-label={`${label}: resultados`}
        size={6}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        style={{
          padding: '0.3rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
        }}
      >
        {matches.map((student) => (
          <option key={student.id} value={student.id}>
            {student.name} · {student.document}
            {student.active ? '' : ' (de baja)'}
          </option>
        ))}
      </select>
      {matches.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          Ningún estudiante coincide con la búsqueda.
        </p>
      )}
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          style={{ margin: 0, color: 'var(--danger)', fontSize: '0.85rem' }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
