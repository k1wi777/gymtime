'use client';

import { useId, useRef, type KeyboardEvent } from 'react';
import type { DayFilterOption } from '@/lib/schedule-groups';
import styles from './DayFilter.module.css';

const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

interface Props {
  /** Visible label of the group, for example «Día». */
  label: string;
  options: readonly DayFilterOption[];
  /** Active weekday (1 to 7), or null for «Todos». */
  value: number | null;
  onChange: (weekday: number | null) => void;
}

/**
 * Single-choice pills (a radio group: they filter one list, there are no tab
 * panels). Arrows, Home and End move and select; only the active pill is in
 * the Tab order.
 */
export function DayFilter({ label, options, value, onChange }: Props) {
  const labelId = useId();
  const group = useRef<HTMLDivElement>(null);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex((option) => option.weekday === value);
    let next = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % options.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + options.length) % options.length;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    const option = options[next];
    if (!option) return;
    onChange(option.weekday);
    group.current
      ?.querySelectorAll<HTMLElement>('[role="radio"]')
      [next]?.focus();
  };

  const active = options.find((option) => option.weekday === value);
  return (
    <div className={styles.row}>
      <span id={labelId} className={styles.label}>
        {label}
      </span>
      <div
        ref={group}
        role="radiogroup"
        aria-labelledby={labelId}
        className={styles.pills}
        onKeyDown={move}
      >
        {options.map((option) => {
          const checked = option.weekday === value;
          return (
            <button
              key={option.weekday ?? 'all'}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className={`${styles.pill} ${checked ? styles.active : ''}`}
              onClick={() => onChange(option.weekday)}
            >
              <span className={styles.name}>
                {option.weekday === null
                  ? 'Todos'
                  : capitalize(option.longLabel)}
              </span>
              <span className={styles.short} aria-hidden="true">
                {option.label}
              </span>
              <span className={styles.count}>{option.count}</span>
            </button>
          );
        })}
      </div>
      <p className="visually-hidden" role="status" aria-live="polite">
        {active
          ? `${active.count} ${active.count === 1 ? 'horario' : 'horarios'}, ${active.longLabel}`
          : ''}
      </p>
    </div>
  );
}
