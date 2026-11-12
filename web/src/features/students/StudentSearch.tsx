'use client';

import { useId, useMemo, useState, type KeyboardEvent, type Ref } from 'react';
import type { Student } from '@/api/types';
import { Avatar } from '@/ui/Avatar';
import { Icon } from '@/ui/icons';
import styles from './StudentSearch.module.css';

/** Lowercase, no accents; `map[i]` is the source index of normalized char `i`. */
function fold(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const piece = (text[i] ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    for (const char of piece) {
      folded += char;
      map.push(i);
    }
  }
  return { folded, map };
}

const digitsOf = (text: string): string => text.replace(/\D/g, '');

export interface SearchStatus {
  label: string;
  /** Not pickable (already in the schedule). */
  disabled?: boolean;
  /** Already chosen: the row is tinted. */
  on?: boolean;
}

interface Props {
  students: readonly Student[];
  onSelect: (student: Student) => void;
  /** `page`: the large search of Registro; `compact`: the one inside a modal. */
  variant?: 'page' | 'compact';
  inputId?: string;
  inputRef?: Ref<HTMLInputElement>;
  ariaLabel?: string;
  placeholder?: string;
  /** Text on the right of every row (default «Elegir»). */
  actionLabel?: string;
  /** Per-student label and state (modal: «Agregar» / «En la lista ✓» / …). */
  statusOf?: (student: Student) => SearchStatus;
  /** Hint shown while nothing is typed; none when omitted. */
  hint?: string;
}

/**
 * ARIA 1.2 combobox: the list appears while typing, matches by name or
 * document ignoring accents and case, and Escape closes the list without
 * reaching an enclosing modal.
 */
export function StudentSearch({
  students,
  onSelect,
  variant = 'page',
  inputId,
  inputRef,
  ariaLabel,
  placeholder = 'Escriba un nombre o una cédula',
  actionLabel = 'Elegir',
  statusOf,
  hint,
}: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(0);

  const needle = useMemo(() => fold(query.trim()).folded, [query]);
  const needleDigits = digitsOf(query);
  const matches = useMemo(() => {
    if (needle === '') return [];
    return students.filter(
      (student) =>
        fold(student.name).folded.includes(needle) ||
        (needleDigits !== '' &&
          digitsOf(student.document).includes(needleDigits)),
    );
  }, [students, needle, needleDigits]);

  const typed = needle !== '';
  const showList = typed && open && matches.length > 0;
  const current = Math.min(active, Math.max(0, matches.length - 1));

  const pick = (student: Student) => {
    if (statusOf?.(student).disabled) return;
    onSelect(student);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && showList) {
      // The first Escape only closes the list; a modal around stays open.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === 'ArrowDown' && matches.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive(showList ? Math.min(current + 1, matches.length - 1) : current);
    } else if (event.key === 'ArrowUp' && showList) {
      event.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && showList) {
      event.preventDefault();
      const student = matches[current];
      if (student) pick(student);
    }
  };

  const optionId = (student: Student) => `${id}-opt-${student.id}`;
  const activeStudent = showList ? matches[current] : undefined;
  const count = `${matches.length} ${matches.length === 1 ? 'coincidencia' : 'coincidencias'}`;

  return (
    <div
      className={`${styles.root} ${variant === 'compact' ? styles.compact : ''}`}
    >
      <div className={styles.field}>
        <Icon
          name="buscar"
          size={18}
          strokeWidth={2}
          className={styles.glass}
        />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeStudent ? optionId(activeStudent) : undefined
          }
          aria-label={ariaLabel}
          autoComplete="off"
          placeholder={placeholder}
          value={query}
          className={styles.input}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {!typed && hint && <div className={styles.hint}>{hint}</div>}
      <div className={showList ? styles.results : styles.hidden}>
        <div className={styles.count} aria-live="polite">
          {showList ? count : ''}
        </div>
        <ul
          id={listId}
          role="listbox"
          aria-label="Estudiantes que coinciden"
          className={styles.list}
        >
          {showList &&
            matches.map((student, index) => {
              const status = statusOf?.(student);
              const { folded, map } = fold(student.name);
              const at = folded.indexOf(needle);
              const from = at >= 0 ? (map[at] ?? 0) : -1;
              const to =
                at >= 0
                  ? (map[at + needle.length - 1] ?? student.name.length - 1) + 1
                  : -1;
              return (
                <li
                  key={student.id}
                  id={optionId(student)}
                  role="option"
                  aria-selected={index === current}
                  aria-disabled={status?.disabled || undefined}
                  className={`${styles.option} ${index === current ? styles.current : ''} ${status?.on ? styles.on : ''} ${status?.disabled ? styles.disabled : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(student)}
                >
                  <Avatar
                    name={student.name}
                    id={student.id}
                    size={variant === 'compact' ? 34 : 38}
                    fontSize={variant === 'compact' ? 12 : 14}
                  />
                  <span className={styles.who}>
                    <span className={styles.name}>
                      {from < 0 ? (
                        student.name
                      ) : (
                        <>
                          {student.name.slice(0, from)}
                          <mark className={styles.mark}>
                            {student.name.slice(from, to)}
                          </mark>
                          {student.name.slice(to)}
                        </>
                      )}
                    </span>
                    <span className={styles.sub}>
                      {student.document}
                      {student.program ? ` · ${student.program}` : ''}
                    </span>
                  </span>
                  <span className={styles.action}>
                    {status?.label ?? actionLabel}
                  </span>
                </li>
              );
            })}
        </ul>
      </div>
      {typed && matches.length === 0 && (
        <div role="status" className={styles.none}>
          Nadie coincide con «{query.trim()}». Revise el nombre o la cédula.
        </div>
      )}
    </div>
  );
}
