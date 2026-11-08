'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import {
  findSchedule,
  groupByWeekday,
  rangeLabel,
  scheduleSummary,
  type SelectableSchedule,
  type WeekdayGroup,
} from '@/lib/schedule-groups';
import { describedBy, FieldFrame } from './Form';
import formStyles from './Form.module.css';
import { Icon } from './icons';
import { Popover } from './Popover';
import styles from './ScheduleSelect.module.css';

interface Props<T extends SelectableSchedule> {
  label: string;
  schedules: readonly T[];
  /** Id of the chosen schedule, or empty. */
  value: string;
  onChange: (id: string) => void;
  /** Offers the option that clears the filter (the empty value). */
  allowAll?: boolean;
  allLabel?: string;
  /** Text of the closed field when nothing is chosen. */
  placeholder?: string;
  /** Id of a schedule to leave out (copying from "another" schedule). */
  exclude?: string;
  error?: string | undefined;
  help?: string | undefined;
  disabled?: boolean;
}

const studentsText = (count: number): string =>
  `${count} ${count === 1 ? 'estudiante' : 'estudiantes'}`;

interface PanelProps<T extends SelectableSchedule> {
  groups: readonly WeekdayGroup<T>[];
  value: string;
  allowAll: boolean;
  allLabel: string;
  onPick: (id: string) => void;
}

/** Day column and schedules column; both are listboxes driven by the keyboard. */
function SchedulePanel<T extends SelectableSchedule>({
  groups,
  value,
  allowAll,
  allLabel,
  onPick,
}: PanelProps<T>) {
  const base = useId();
  const chosen = findSchedule(groups, value);
  const [day, setDay] = useState<number>(
    () =>
      chosen?.group.weekday ??
      groups.find((group) => group.schedules.length > 0)?.weekday ??
      1,
  );
  const group = groups.find((item) => item.weekday === day) ?? groups[0];
  const [active, setActive] = useState(0);
  const dayList = useRef<HTMLDivElement>(null);
  const scheduleList = useRef<HTMLDivElement>(null);
  const schedules = group?.schedules ?? [];

  const withSchedules = groups.filter((item) => item.schedules.length > 0);
  const stepDay = (delta: number) => {
    const at = withSchedules.findIndex((item) => item.weekday === day);
    const next = withSchedules[at + delta];
    if (next) setDay(next.weekday);
  };
  const toSchedules = () => {
    if (schedules.length === 0) return;
    const at = schedules.findIndex((item) => item.id === value);
    setActive(at >= 0 ? at : 0);
    scheduleList.current?.focus();
  };

  const onDayKey = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        stepDay(1);
        break;
      case 'ArrowUp':
        stepDay(-1);
        break;
      case 'Home':
        if (withSchedules[0]) setDay(withSchedules[0].weekday);
        break;
      case 'End': {
        const last = withSchedules[withSchedules.length - 1];
        if (last) setDay(last.weekday);
        break;
      }
      case 'ArrowRight':
      case 'Enter':
      case ' ':
        toSchedules();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onScheduleKey = (event: KeyboardEvent) => {
    const last = schedules.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        setActive((current) => Math.min(current + 1, last));
        break;
      case 'ArrowUp':
        setActive((current) => Math.max(current - 1, 0));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(last);
        break;
      case 'ArrowLeft':
        dayList.current?.focus();
        break;
      case 'Enter':
      case ' ': {
        const target = schedules[active];
        if (target) onPick(target.id);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className={styles.panel}>
      {allowAll && (
        <button
          type="button"
          className={styles.all}
          aria-pressed={value === ''}
          onClick={() => onPick('')}
        >
          {allLabel}
        </button>
      )}
      <div className={styles.columns}>
        <div
          ref={dayList}
          role="listbox"
          aria-label="Día de la semana"
          tabIndex={0}
          data-autofocus=""
          aria-activedescendant={`${base}-day-${day}`}
          className={`${styles.days} ${styles.list}`}
          onKeyDown={onDayKey}
        >
          {groups.map((item) => {
            const empty = item.schedules.length === 0;
            return (
              <div
                key={item.weekday}
                id={`${base}-day-${item.weekday}`}
                role="option"
                aria-selected={item.weekday === day}
                aria-disabled={empty || undefined}
                aria-label={`${item.longLabel}, ${item.schedules.length} ${item.schedules.length === 1 ? 'horario' : 'horarios'}`}
                className={`${styles.option} ${item.weekday === day ? styles.selected : ''} ${empty ? styles.empty : ''}`}
                onClick={() => !empty && setDay(item.weekday)}
              >
                <span className={styles.grow}>{item.label}</span>
                <span className={styles.count}>{item.schedules.length}</span>
              </div>
            );
          })}
        </div>
        <div
          ref={scheduleList}
          role="listbox"
          aria-label={`Horarios del ${group?.longLabel ?? ''}`}
          tabIndex={0}
          aria-activedescendant={
            schedules[active] ? `${base}-s-${schedules[active].id}` : undefined
          }
          className={`${styles.schedules} ${styles.list}`}
          onKeyDown={onScheduleKey}
        >
          <div className={styles.dayTitle} aria-hidden="true">
            {group?.longLabel}
          </div>
          {schedules.map((item, index) => (
            <div
              key={item.id}
              id={`${base}-s-${item.id}`}
              role="option"
              aria-selected={item.id === value}
              className={`${styles.option} ${item.id === value ? styles.selected : ''} ${index === active ? styles.active : ''}`}
              onClick={() => onPick(item.id)}
            >
              <span className={styles.radio} aria-hidden="true">
                {item.id === value && <span className={styles.radioDot} />}
              </span>
              <span className={styles.grow}>
                <strong>{rangeLabel(item)}</strong>
                <span className={styles.name}>{item.name}</span>
              </span>
              {item.students && (
                <span className={styles.students}>
                  {studentsText(item.students.length)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Schedule picker: first the weekday (with its count), then the schedule. */
export function ScheduleSelect<T extends SelectableSchedule>({
  label,
  schedules,
  value,
  onChange,
  allowAll = false,
  allLabel = 'Todos los horarios',
  placeholder = 'Elija un horario',
  exclude,
  error,
  help,
  disabled,
}: Props<T>) {
  const id = useId();
  const groups = groupByWeekday(
    exclude ? schedules.filter((item) => item.id !== exclude) : schedules,
  );
  const chosen = value === '' ? undefined : findSchedule(groups, value);
  const text = chosen
    ? scheduleSummary(chosen.group, chosen.schedule)
    : value === '' && allowAll
      ? allLabel
      : placeholder;
  return (
    <FieldFrame id={id} label={label} error={error} help={help}>
      <Popover
        label={`Elegir ${label.toLowerCase()}`}
        trigger={(triggerProps) => (
          <button
            type="button"
            id={id}
            {...triggerProps}
            disabled={disabled}
            aria-labelledby={`${id}-label ${id}-value`}
            aria-describedby={describedBy(id, error, help)}
            className={`${formStyles.input} ${styles.field}`}
          >
            <Icon name="ahora" size={18} />
            <span
              id={`${id}-value`}
              className={chosen || allowAll ? styles.value : styles.placeholder}
            >
              {text}
            </span>
          </button>
        )}
      >
        {(close) => (
          <SchedulePanel
            groups={groups}
            value={value}
            allowAll={allowAll}
            allLabel={allLabel}
            onPick={(next) => {
              onChange(next);
              close();
            }}
          />
        )}
      </Popover>
    </FieldFrame>
  );
}
