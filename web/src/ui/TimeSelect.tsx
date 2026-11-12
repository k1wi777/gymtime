'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { HOURS, joinTime, minuteOptions, parseTime } from '@/lib/time-select';
import { describedBy, FieldFrame } from './Form';
import formStyles from './Form.module.css';
import { Icon } from './icons';
import { Popover } from './Popover';
import styles from './TimeSelect.module.css';

interface Props {
  label: string;
  /** `HH:mm`, or empty when no time is chosen. */
  value: string;
  onChange: (next: string) => void;
  /** Text of the closed field when nothing is chosen. */
  placeholder?: string;
  error?: string | undefined;
  help?: string | undefined;
  disabled?: boolean;
}

const DEFAULT_HOUR = '08';
const DEFAULT_MINUTE = '00';

interface ColumnProps {
  base: string;
  title: string;
  options: readonly string[];
  selected: string | undefined;
  active: number;
  setActive: (index: number) => void;
  onPick: (option: string) => void;
  listRef: RefObject<HTMLDivElement | null>;
  autofocus?: boolean;
  onSide: (direction: 'left' | 'right') => void;
}

/** One listbox (hours or minutes) driven by the keyboard. */
function Column({
  base,
  title,
  options,
  selected,
  active,
  setActive,
  onPick,
  listRef,
  autofocus,
  onSide,
}: ColumnProps) {
  const activeId = `${base}-${options[active]}`;
  useEffect(() => {
    const element = document.getElementById(activeId);
    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ block: 'nearest' });
    }
  }, [activeId]);

  const onKey = (event: KeyboardEvent) => {
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        setActive(Math.min(active + 1, last));
        break;
      case 'ArrowUp':
        setActive(Math.max(active - 1, 0));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(last);
        break;
      case 'ArrowRight':
        onSide('right');
        break;
      case 'ArrowLeft':
        onSide('left');
        break;
      case 'Enter':
      case ' ': {
        const option = options[active];
        if (option) onPick(option);
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div>
      <div className={styles.heading} aria-hidden="true">
        {title}
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={title === 'Hora' ? 'Horas' : 'Minutos'}
        tabIndex={0}
        {...(autofocus ? { 'data-autofocus': '' } : {})}
        aria-activedescendant={activeId}
        className={styles.list}
        onKeyDown={onKey}
      >
        {options.map((option, index) => (
          <div
            key={option}
            id={`${base}-${option}`}
            role="option"
            aria-selected={option === selected}
            className={`${styles.option} ${option === selected ? styles.selected : ''} ${index === active ? styles.active : ''}`}
            onClick={() => {
              setActive(index);
              onPick(option);
            }}
          >
            {option}
          </div>
        ))}
      </div>
    </div>
  );
}

interface PanelProps {
  value: string;
  onChange: (next: string) => void;
  onDone: () => void;
}

/** Hours and minutes side by side; the panel stays open until "Listo". */
function TimePanel({ value, onChange, onDone }: PanelProps) {
  const base = useId();
  const current = parseTime(value);
  const minutes = minuteOptions(current?.minute);
  const [hourAt, setHourAt] = useState(() =>
    Math.max(0, HOURS.indexOf(current?.hour ?? DEFAULT_HOUR)),
  );
  const [minuteAt, setMinuteAt] = useState(() =>
    Math.max(0, minutes.indexOf(current?.minute ?? DEFAULT_MINUTE)),
  );
  const hourList = useRef<HTMLDivElement>(null);
  const minuteList = useRef<HTMLDivElement>(null);

  const pickHour = (hour: string) =>
    onChange(joinTime(hour, current?.minute ?? DEFAULT_MINUTE));
  const pickMinute = (minute: string) =>
    onChange(joinTime(current?.hour ?? HOURS[hourAt] ?? DEFAULT_HOUR, minute));

  return (
    <div className={styles.panel}>
      <div className={styles.columns}>
        <Column
          base={`${base}-h`}
          title="Hora"
          options={HOURS}
          selected={current?.hour}
          active={hourAt}
          setActive={setHourAt}
          onPick={pickHour}
          listRef={hourList}
          autofocus
          onSide={(direction) =>
            direction === 'right' && minuteList.current?.focus()
          }
        />
        <Column
          base={`${base}-m`}
          title="Minutos"
          options={minutes}
          selected={current?.minute}
          active={Math.min(minuteAt, minutes.length - 1)}
          setActive={setMinuteAt}
          onPick={pickMinute}
          listRef={minuteList}
          onSide={(direction) =>
            direction === 'left' && hourList.current?.focus()
          }
        />
      </div>
      <div className={styles.footer}>
        <span className={styles.big} aria-hidden="true">
          {current ? value : '--:--'}
        </span>
        <button type="button" className="btn btn-primary" onClick={onDone}>
          Listo
        </button>
      </div>
    </div>
  );
}

/** Hour picker: a field that opens hours (00-23) and minutes (every 5). */
export function TimeSelect({
  label,
  value,
  onChange,
  placeholder = 'Elija la hora',
  error,
  help,
  disabled,
}: Props) {
  const id = useId();
  const chosen = parseTime(value) !== undefined;
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
            <span className={styles.lead}>
              <Icon name="ahora" size={18} />
              <span
                id={`${id}-value`}
                className={chosen ? styles.value : styles.placeholder}
              >
                {chosen ? value : placeholder}
              </span>
            </span>
            <Icon name="chevronDown" size={16} strokeWidth={2} />
          </button>
        )}
      >
        {(close) => (
          <TimePanel value={value} onChange={onChange} onDone={close} />
        )}
      </Popover>
    </FieldFrame>
  );
}
