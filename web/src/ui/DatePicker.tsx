'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { bogotaDay } from '@/lib/time';
import {
  addDays,
  addMonths,
  compareDay,
  expandClosedDays,
  formatPickerDay,
  fullDayName,
  isDisabled,
  isValidDay,
  MONTHS,
  monthGrid,
  pickRangeDay,
  rangeInstruction,
  shortcutRange,
  weekdayIndex,
  type DayBounds,
  type DayRange,
  type RangeEnd,
  type ShortcutKind,
} from '@/lib/calendar';
import { describedBy, FieldFrame } from './Form';
import formStyles from './Form.module.css';
import { Icon } from './icons';
import { Popover, type PopoverTriggerProps } from './Popover';
import styles from './DatePicker.module.css';

const HEADERS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'] as const;
const SHORTCUT_LABELS: Record<ShortcutKind, string> = {
  today: 'Hoy',
  last7: 'Últimos 7 días',
  period: 'Todo el periodo',
  clear: 'Limpiar',
};

interface PeriodProps {
  /** Reference period: days outside it cannot be chosen. */
  bounds?: DayBounds | undefined;
  /** Exceptions (days without service) of the period, marked on the grid. */
  closedDays?: ReadonlyArray<{ from: string; to: string }> | undefined;
  /** Today (`YYYY-MM-DD`); the Bogota day by default. */
  today?: string | undefined;
}

interface PanelProps extends PeriodProps {
  mode: 'range' | 'single';
  from: string;
  to: string;
  shortcuts: readonly ShortcutKind[];
  /** Both ends are labelled in the panel and in the adjustment notice. */
  fromLabel?: string;
  toLabel?: string;
  /** The end a click edits when the panel opens on a complete range. */
  initialEnd?: RangeEnd;
  onApply: (range: DayRange, close: boolean) => void;
}

/** First day the grid focuses: the value, or today, kept inside the period. */
function startingDay(
  value: string,
  today: string,
  bounds: DayBounds | undefined,
): string {
  const day = isValidDay(value) ? value : today;
  if (!isDisabled(day, bounds) || !bounds) return day;
  return day < bounds.start ? bounds.start : bounds.end;
}

/** One of the two ends in the side column: shows the day, picks the end. */
function EndButton({
  label,
  value,
  pressed,
  onClick,
}: {
  label: string;
  value: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.end}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span className={styles.endLabel}>{label}</span>
      <span className={styles.endValue}>
        {isValidDay(value) ? formatPickerDay(value) : 'Sin fecha'}
      </span>
    </button>
  );
}

/**
 * The calendar: one month, Monday first, with roving focus. An incomplete
 * range is built here (`pending` holds the first click) and emitted on the
 * second; a complete one edits only the active end (see `pickRangeDay`).
 */
function CalendarPanel({
  mode,
  from,
  to,
  bounds,
  closedDays,
  today: todayProp,
  shortcuts,
  fromLabel = 'Desde',
  toLabel = 'Hasta',
  initialEnd = 'from',
  onApply,
}: PanelProps) {
  const today = todayProp ?? bogotaDay(new Date());
  const closed = expandClosedDays(closedDays ?? []);
  const [focusDay, setFocusDay] = useState(() =>
    startingDay(
      initialEnd === 'to' && isValidDay(to) ? to : from,
      today,
      bounds,
    ),
  );
  const [pending, setPending] = useState<string | null>(null);
  const [end, setEnd] = useState<RangeEnd>(initialEnd);
  const [notice, setNotice] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focusDay]);

  const year = Number(focusDay.slice(0, 4));
  const month = Number(focusDay.slice(5, 7)) - 1;
  const cells = monthGrid(year, month);

  const single = mode === 'single';
  const complete = isValidDay(from) && isValidDay(to) && from <= to;
  // Until the range is complete the order is fixed: from, then to.
  const active: RangeEnd = complete ? end : pending !== null ? 'to' : 'from';
  const shown: DayRange =
    pending !== null
      ? { from: pending, to: pending }
      : { from: isValidDay(from) ? from : '', to: isValidDay(to) ? to : '' };
  const isEdge = (day: string) => day === shown.from || day === shown.to;
  const isActiveEdge = (day: string) =>
    !single && complete && day === (active === 'from' ? from : to);
  const inside = (day: string) =>
    shown.from !== '' &&
    shown.to !== '' &&
    compareDay(day, shown.from) > 0 &&
    compareDay(day, shown.to) < 0;

  const pick = (day: string) => {
    if (isDisabled(day, bounds)) return;
    if (single) return onApply({ from: day, to: day }, true);
    const result = pickRangeDay({ from, to, active, pending }, day);
    setEnd(result.active);
    setPending(result.pending);
    setNotice(
      result.adjusted === 'to'
        ? `“${toLabel}” se ajustó al ${formatPickerDay(day)} para que no sea anterior a “${fromLabel}”.`
        : result.adjusted === 'from'
          ? `“${fromLabel}” se ajustó al ${formatPickerDay(day)} para que no sea posterior a “${toLabel}”.`
          : '',
    );
    if (result.emit) onApply(result.range, result.close);
    if (result.active === 'to' && result.emit && !result.close) {
      go(isValidDay(result.range.to) ? result.range.to : day, true);
    }
  };

  const chooseEnd = (next: RangeEnd) => {
    setEnd(next);
    setPending(null);
    setNotice('');
    const value = next === 'from' ? from : to;
    go(startingDay(value, today, bounds), true);
  };

  const go = (day: string, focus: boolean) => {
    moveFocus.current = focus;
    setFocusDay(day);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const steps: Record<string, string> = {
      ArrowLeft: addDays(focusDay, -1),
      ArrowRight: addDays(focusDay, 1),
      ArrowUp: addDays(focusDay, -7),
      ArrowDown: addDays(focusDay, 7),
      Home: addDays(focusDay, -weekdayIndex(focusDay)),
      End: addDays(focusDay, 6 - weekdayIndex(focusDay)),
      PageUp: addMonths(focusDay, -1),
      PageDown: addMonths(focusDay, 1),
    };
    const next = steps[event.key];
    if (next === undefined) return;
    event.preventDefault();
    go(next, true);
  };

  const applyShortcut = (kind: ShortcutKind) => {
    const range = shortcutRange(kind, today, bounds);
    if (!range) return;
    if (bounds && range.from !== '' && range.from < bounds.start) {
      range.from = bounds.start;
    }
    onApply(range, true);
  };
  const shortcutOff = (kind: ShortcutKind) =>
    (kind === 'today' || kind === 'last7') && isDisabled(today, bounds);

  const instruction = rangeInstruction({
    single,
    complete,
    active,
    pending: pending !== null,
  });
  return (
    <div className={styles.calendar}>
      <div role="status" className={styles.instruction}>
        <strong>{instruction}</strong>
        {notice !== '' && <span className={styles.notice}>{notice}</span>}
      </div>
      <div className={styles.body}>
        <div className={styles.monthCol}>
          <div className={styles.head}>
            <button
              type="button"
              className={styles.nav}
              aria-label="Mes anterior"
              onClick={() => go(addMonths(focusDay, -1), false)}
            >
              <Icon name="chevronLeft" size={16} strokeWidth={2} />
            </button>
            <div className={styles.month} aria-live="polite">
              {MONTHS[month]} de {year}
            </div>
            <button
              type="button"
              className={styles.nav}
              aria-label="Mes siguiente"
              onClick={() => go(addMonths(focusDay, 1), false)}
            >
              <Icon name="chevron" size={16} strokeWidth={2} />
            </button>
          </div>
          <div
            ref={grid}
            role="grid"
            aria-label={`${MONTHS[month]} de ${year}`}
            onKeyDown={onKeyDown}
          >
            <div role="row" className={styles.week} aria-hidden="true">
              {HEADERS.map((name) => (
                <span key={name} className={styles.weekday}>
                  {name}
                </span>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, row) => (
              <div key={row} role="row" className={styles.week}>
                {cells.slice(row * 7, row * 7 + 7).map(({ iso, inMonth }) => {
                  const off = isDisabled(iso, bounds);
                  const edge = isEdge(iso);
                  const middle = inside(iso);
                  const noService = closed.has(iso);
                  const name = [
                    fullDayName(iso),
                    iso === today ? 'hoy' : '',
                    noService ? 'día sin servicio' : '',
                    off ? 'fuera del periodo' : '',
                  ]
                    .filter(Boolean)
                    .join(', ');
                  const classes = [
                    styles.day,
                    inMonth ? '' : styles.outside,
                    middle ? styles.middle : '',
                    edge ? styles.edge : '',
                    isActiveEdge(iso) ? styles.activeEdge : '',
                    off ? styles.off : '',
                    iso === today && !edge ? styles.today : '',
                  ];
                  return (
                    <div key={iso} role="gridcell" className={styles.cell}>
                      <button
                        type="button"
                        className={classes.filter(Boolean).join(' ')}
                        aria-label={name}
                        aria-pressed={edge}
                        aria-disabled={off || undefined}
                        tabIndex={iso === focusDay ? 0 : -1}
                        data-autofocus={iso === focusDay ? '' : undefined}
                        onFocus={() => iso !== focusDay && setFocusDay(iso)}
                        onClick={() => pick(iso)}
                      >
                        {Number(iso.slice(8, 10))}
                        {noService && (
                          <span className={styles.dot} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className={styles.side}>
          {!single && (
            <div className={styles.ends}>
              <EndButton
                label={fromLabel}
                value={shown.from}
                pressed={active === 'from'}
                onClick={() => chooseEnd('from')}
              />
              <EndButton
                label={toLabel}
                value={pending !== null ? '' : shown.to}
                pressed={active === 'to'}
                onClick={() => chooseEnd('to')}
              />
            </div>
          )}
          <div className={styles.shortcuts}>
            {shortcuts.map((kind) => (
              <button
                key={kind}
                type="button"
                className={`${styles.chip} ${kind === 'clear' ? styles.chipMuted : ''}`}
                disabled={shortcutOff(kind)}
                onClick={() => applyShortcut(kind)}
              >
                {SHORTCUT_LABELS[kind]}
              </button>
            ))}
          </div>
          <ul className={styles.legend} aria-label="Leyenda">
            <li>
              <span className={`${styles.swatch} ${styles.swatchToday}`} />
              Hoy
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.swatchDot}`} />
              Día sin servicio
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.swatchRange}`} />
              Rango elegido
            </li>
            <li>
              <span className={`${styles.swatch} ${styles.swatchOff}`} />
              Fuera del periodo
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

interface FieldButtonProps {
  id: string;
  triggerProps: PopoverTriggerProps;
  text: string;
  empty: boolean;
  error?: string | undefined;
  help?: string | undefined;
  disabled?: boolean | undefined;
}

/** The closed field: looks like the other inputs, opens the calendar. */
function FieldButton({
  id,
  triggerProps,
  text,
  empty,
  error,
  help,
  disabled,
}: FieldButtonProps) {
  return (
    <button
      type="button"
      id={id}
      {...triggerProps}
      disabled={disabled}
      aria-labelledby={`${id}-label ${id}-value`}
      aria-describedby={describedBy(id, error, help)}
      className={`${formStyles.input} ${styles.field}`}
    >
      <Icon name="calendario" size={18} />
      <span
        id={`${id}-value`}
        className={empty ? styles.placeholder : styles.value}
      >
        {text}
      </span>
    </button>
  );
}

const dayText = (value: string, placeholder: string): string =>
  value === ''
    ? placeholder
    : isValidDay(value)
      ? formatPickerDay(value)
      : value;

interface DatePickerProps extends PeriodProps {
  label: string;
  /** `YYYY-MM-DD`, or empty for no date. */
  value: string;
  onChange: (value: string) => void;
  /** Offers «Limpiar» (an optional field). */
  clearable?: boolean;
  placeholder?: string;
  error?: string | undefined;
  help?: string | undefined;
  disabled?: boolean;
}

/** A single date. */
export function DatePicker({
  label,
  value,
  onChange,
  clearable = false,
  placeholder = 'Sin fecha',
  error,
  help,
  disabled,
  bounds,
  closedDays,
  today,
}: DatePickerProps) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} error={error} help={help}>
      <Popover
        label={`Calendario de ${label}`}
        trigger={(triggerProps) => (
          <FieldButton
            id={id}
            triggerProps={triggerProps}
            text={dayText(value, placeholder)}
            empty={value === ''}
            error={error}
            help={help}
            disabled={disabled}
          />
        )}
      >
        {(close) => (
          <CalendarPanel
            mode="single"
            from={value}
            to={value}
            bounds={bounds}
            closedDays={closedDays}
            today={today}
            shortcuts={clearable ? ['today', 'clear'] : ['today']}
            onApply={(range) => {
              onChange(range.from);
              close();
            }}
          />
        )}
      </Popover>
    </FieldFrame>
  );
}

interface DateRangePickerProps extends PeriodProps {
  fromLabel?: string;
  toLabel?: string;
  from: string;
  to: string;
  /** Called once with both ends, only when the range is complete. */
  onChange: (range: DayRange) => void;
  fromError?: string | undefined;
  toError?: string | undefined;
  fromHelp?: string | undefined;
  toHelp?: string | undefined;
  placeholder?: string;
  /** Layout class of the pair inside the form. */
  className?: string;
  /** Shortcuts offered; «Todo el periodo» only appears with `bounds`. */
  shortcuts?: readonly ShortcutKind[];
}

/** Two fields (from and to) that open one calendar: a click on each end. */
export function DateRangePicker({
  fromLabel = 'Desde',
  toLabel = 'Hasta',
  from,
  to,
  onChange,
  fromError,
  toError,
  fromHelp,
  toHelp,
  placeholder = 'Sin fecha',
  className,
  shortcuts = ['today', 'last7', 'period', 'clear'],
  bounds,
  closedDays,
  today,
}: DateRangePickerProps) {
  const fromId = useId();
  const toId = useId();
  const offered = shortcuts.filter((kind) => kind !== 'period' || bounds);
  // The end whose field opened the panel: the one a click edits first.
  const [opened, setOpened] = useState<RangeEnd>('from');
  const openFrom = (props: PopoverTriggerProps, end: RangeEnd) => ({
    ...props,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      setOpened(end);
      props.onClick(event);
    },
  });
  return (
    <div className={`${styles.range} ${className ?? ''}`}>
      <Popover
        label={`Calendario de ${fromLabel} y ${toLabel}`}
        trigger={(triggerProps) => (
          <div className={styles.pair}>
            <FieldFrame
              id={fromId}
              label={fromLabel}
              error={fromError}
              help={fromHelp}
            >
              <FieldButton
                id={fromId}
                triggerProps={openFrom(triggerProps, 'from')}
                text={dayText(from, placeholder)}
                empty={from === ''}
                error={fromError}
                help={fromHelp}
              />
            </FieldFrame>
            <FieldFrame id={toId} label={toLabel} error={toError} help={toHelp}>
              <FieldButton
                id={toId}
                triggerProps={openFrom(triggerProps, 'to')}
                text={dayText(to, placeholder)}
                empty={to === ''}
                error={toError}
                help={toHelp}
              />
            </FieldFrame>
          </div>
        )}
      >
        {(close) => (
          <CalendarPanel
            mode="range"
            from={from}
            to={to}
            bounds={bounds}
            closedDays={closedDays}
            today={today}
            shortcuts={offered}
            fromLabel={fromLabel}
            toLabel={toLabel}
            initialEnd={opened}
            onApply={(range, done) => {
              onChange(range);
              if (done) close();
            }}
          />
        )}
      </Popover>
    </div>
  );
}
