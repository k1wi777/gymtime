import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { DatePicker, DateRangePicker } from '@/ui/DatePicker';
import { ScheduleSelect } from '@/ui/ScheduleSelect';
import type { DayRange } from '@/lib/calendar';

const TODAY = '2026-11-07';
const BOUNDS = { start: '2026-09-07', end: '2026-12-13' };

const dayButton = (text: RegExp) =>
  within(screen.getByRole('dialog')).getByRole('button', { name: text });

function Range({
  onChange,
  bounds,
  closedDays,
  initial = { from: '', to: '' },
}: {
  onChange: (range: DayRange) => void;
  bounds?: typeof BOUNDS;
  closedDays?: Array<{ from: string; to: string }>;
  initial?: DayRange;
}) {
  const [range, setRange] = useState(initial);
  return (
    <DateRangePicker
      from={range.from}
      to={range.to}
      today={TODAY}
      bounds={bounds}
      closedDays={closedDays}
      onChange={(next) => {
        setRange(next);
        onChange(next);
      }}
    />
  );
}

describe('DateRangePicker', () => {
  it('emits nothing after the first day and both ends after the second', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Range onChange={onChange} />);
    await user.click(screen.getByLabelText('Desde'));
    await user.click(dayButton(/^lunes 2 de noviembre de 2026/));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Elija el último día.');
    await user.click(dayButton(/^sábado 7 de noviembre de 2026/));
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-11-02',
      to: '2026-11-07',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Desde').textContent).toContain('2 nov 2026');
    expect(screen.getByLabelText('Hasta').textContent).toContain('7 nov 2026');
  });

  it('orders the ends when the second day is earlier', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Range onChange={onChange} />);
    await user.click(screen.getByLabelText('Hasta'));
    await user.click(dayButton(/^sábado 7 de noviembre de 2026/));
    await user.click(dayButton(/^lunes 2 de noviembre de 2026/));
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-11-02',
      to: '2026-11-07',
    });
  });

  it('takes one date with two clicks on the same day', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Range onChange={onChange} />);
    await user.click(screen.getByLabelText('Desde'));
    await user.click(dayButton(/^martes 3 de noviembre de 2026/));
    await user.click(dayButton(/^martes 3 de noviembre de 2026/));
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-11-03',
      to: '2026-11-03',
    });
  });

  it('applies the shortcuts in one click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Range onChange={onChange} bounds={BOUNDS} />);
    await user.click(screen.getByLabelText('Desde'));
    await user.click(screen.getByRole('button', { name: 'Últimos 7 días' }));
    expect(onChange).toHaveBeenLastCalledWith({
      from: '2026-11-01',
      to: TODAY,
    });
    await user.click(screen.getByLabelText('Desde'));
    await user.click(screen.getByRole('button', { name: 'Todo el periodo' }));
    expect(onChange).toHaveBeenLastCalledWith({
      from: BOUNDS.start,
      to: BOUNDS.end,
    });
    await user.click(screen.getByLabelText('Desde'));
    await user.click(screen.getByRole('button', { name: 'Hoy' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: TODAY, to: TODAY });
    await user.click(screen.getByLabelText('Desde'));
    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(onChange).toHaveBeenLastCalledWith({ from: '', to: '' });
  });

  it('offers «Todo el periodo» only with a reference period', async () => {
    const user = userEvent.setup();
    render(<Range onChange={vi.fn()} />);
    await user.click(screen.getByLabelText('Desde'));
    expect(
      screen.queryByRole('button', { name: 'Todo el periodo' }),
    ).toBeNull();
  });

  it('disables days outside the period and marks days without service', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Range
        onChange={onChange}
        bounds={BOUNDS}
        closedDays={[{ from: '2026-11-16', to: '2026-11-17' }]}
        initial={{ from: '2026-12-10', to: '2026-12-13' }}
      />,
    );
    await user.click(screen.getByLabelText('Desde'));
    const out = dayButton(/^lunes 14 de diciembre de 2026.*fuera del periodo/);
    expect(out.getAttribute('aria-disabled')).toBe('true');
    await user.click(out);
    expect(screen.getByRole('status').textContent).toBe(
      'Del 10 dic 2026 al 13 dic 2026.',
    );
    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));
    expect(
      dayButton(/^lunes 16 de noviembre de 2026, día sin servicio/),
    ).toBeTruthy();
    expect(
      dayButton(/^domingo 1 de noviembre de 2026/).getAttribute(
        'aria-disabled',
      ),
    ).toBeNull();
  });

  it('is operable with the keyboard and Escape returns the focus', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Range onChange={onChange} />);
    const field = screen.getByLabelText('Desde');
    field.focus();
    await user.keyboard('{Enter}');
    // The focus starts on today (Saturday 7).
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(
      /^sábado 7 de noviembre de 2026/,
    );
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(
      /^viernes 30 de octubre de 2026/,
    );
    await user.keyboard('{Enter}');
    expect(document.activeElement?.getAttribute('aria-pressed')).toBe('true');
    await user.keyboard('{Home}{Enter}');
    expect(onChange).toHaveBeenCalledWith({
      from: '2026-10-26',
      to: '2026-10-30',
    });
    expect(document.activeElement).toBe(field);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(field);
  });

  it('closes on a click outside and discards a half-chosen range', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <Range onChange={onChange} />
        <button type="button">Fuera</button>
      </>,
    );
    await user.click(screen.getByLabelText('Desde'));
    await user.click(dayButton(/^lunes 2 de noviembre de 2026/));
    await user.click(screen.getByRole('button', { name: 'Fuera' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText('Desde'));
    expect(screen.getByRole('status').textContent).toBe('Sin fecha elegida.');
  });

  it('shows the error of a field', () => {
    render(
      <DateRangePicker
        from="2026-1-1"
        to=""
        onChange={vi.fn()}
        fromError="Use AAAA-MM-DD."
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Use AAAA-MM-DD.');
  });
});

describe('DatePicker', () => {
  it('picks one day, clears it when optional', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        label="Desde (opcional)"
        value="2026-11-02"
        today={TODAY}
        clearable
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText('Desde (opcional)'));
    await user.click(dayButton(/^miércoles 4 de noviembre de 2026/));
    expect(onChange).toHaveBeenLastCalledWith('2026-11-04');
    await user.click(screen.getByLabelText('Desde (opcional)'));
    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('has no «Limpiar» when required', async () => {
    const user = userEvent.setup();
    render(
      <DatePicker label="Fecha" value="" today={TODAY} onChange={vi.fn()} />,
    );
    await user.click(screen.getByLabelText('Fecha'));
    expect(screen.queryByRole('button', { name: 'Limpiar' })).toBeNull();
  });
});

const schedule = (
  id: string,
  weekday: number | null,
  start: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name: `Grupo ${id}`,
  weekday,
  date: null,
  startTime: `${start}:00`,
  endTime: '19:00:00',
  students: [{}, {}, {}],
  ...extra,
});

const SCHEDULES = [
  schedule('a', 1, '18'),
  schedule('b', 1, '06'),
  schedule('c', 3, '07'),
  schedule('d', null, '10', { date: '2026-11-07' }),
];

function Select({
  onChange,
  initial = '',
  ...rest
}: {
  onChange: (id: string) => void;
  initial?: string;
  allowAll?: boolean;
  exclude?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ScheduleSelect
      label="Horario"
      schedules={SCHEDULES}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
      {...rest}
    />
  );
}

describe('ScheduleSelect', () => {
  it('goes from the day to its schedules, ordered', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select onChange={onChange} />);
    await user.click(screen.getByLabelText('Horario'));
    const dialog = within(screen.getByRole('dialog'));
    const days = dialog.getAllByRole('option', { name: /horario/ });
    expect(days).toHaveLength(7);
    expect(days[0]?.getAttribute('aria-label')).toBe('lunes, 2 horarios');
    // Monday opens first and lists 06:00 before 18:00.
    const options = dialog
      .getAllByRole('option')
      .filter((o) => /Grupo/.test(o.textContent ?? ''));
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('06:00–19:00'),
      expect.stringContaining('18:00–19:00'),
    ]);
    expect(options[0]?.textContent).toContain('3 estudiantes');
    await user.click(dialog.getByRole('option', { name: /^miércoles/ }));
    await user.click(dialog.getByRole('option', { name: /Grupo c/ }));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.getByLabelText('Horario').textContent).toContain(
      'Mié 07:00–19:00 · Grupo c',
    );
  });

  it('disables empty days and groups a one-off schedule by its date', async () => {
    const user = userEvent.setup();
    render(<Select onChange={vi.fn()} />);
    await user.click(screen.getByLabelText('Horario'));
    const dialog = within(screen.getByRole('dialog'));
    expect(
      dialog
        .getByRole('option', { name: /^martes/ })
        .getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      dialog.getByRole('option', { name: 'sábado, 1 horario' }),
    ).toBeTruthy();
  });

  it('opens on the day of the chosen schedule', async () => {
    const user = userEvent.setup();
    render(<Select onChange={vi.fn()} initial="c" />);
    await user.click(screen.getByLabelText('Horario'));
    const dialog = within(screen.getByRole('dialog'));
    expect(
      dialog
        .getByRole('option', { name: /^miércoles/ })
        .getAttribute('aria-selected'),
    ).toBe('true');
    expect(
      dialog
        .getByRole('option', { name: /Grupo c/ })
        .getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('offers «Todos los horarios» that returns the empty value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select onChange={onChange} initial="a" allowAll />);
    await user.click(screen.getByLabelText('Horario'));
    await user.click(
      screen.getByRole('button', { name: 'Todos los horarios' }),
    );
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.getByLabelText('Horario').textContent).toContain(
      'Todos los horarios',
    );
  });

  it('leaves out the excluded schedule', async () => {
    const user = userEvent.setup();
    render(<Select onChange={vi.fn()} exclude="a" />);
    await user.click(screen.getByLabelText('Horario'));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('option', { name: /Grupo a/ })).toBeNull();
    expect(
      dialog.getByRole('option', { name: 'lunes, 1 horario' }),
    ).toBeTruthy();
  });

  it('is operable with the keyboard', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Select onChange={onChange} />);
    const field = screen.getByLabelText('Horario');
    field.focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Día de la semana',
    );
    await user.keyboard('{ArrowDown}'); // Monday -> Wednesday (Tuesday is empty)
    expect(
      screen
        .getByRole('option', { name: /^miércoles/ })
        .getAttribute('aria-selected'),
    ).toBe('true');
    await user.keyboard('{ArrowUp}{ArrowRight}{ArrowDown}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Horarios del lunes',
    );
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('a');
    expect(document.activeElement).toBe(field);
    await user.keyboard('{Enter}{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(field);
  });
});
