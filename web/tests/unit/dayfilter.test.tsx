import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { DayFilter } from '@/ui/DayFilter';
import { dayFilterOptions } from '@/lib/schedule-groups';

const schedules = [
  { id: 'a', name: 'A', weekday: 2, startTime: '06:00', endTime: '07:00' },
  { id: 'b', name: 'B', weekday: 2, startTime: '07:00', endTime: '08:00' },
  { id: 'c', name: 'C', weekday: 4, startTime: '06:00', endTime: '07:00' },
];

function Host() {
  const [day, setDay] = useState<number | null>(2);
  return (
    <DayFilter
      label="Día"
      options={dayFilterOptions(schedules)}
      value={day}
      onChange={setDay}
    />
  );
}

describe('DayFilter (R17, R19)', () => {
  it('is a labelled radio group with one checked pill and counts', () => {
    render(<Host />);
    const group = screen.getByRole('radiogroup', { name: 'Día' });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(screen.getByRole('radio', { name: /Martes/ }).textContent).toContain(
      '2',
    );
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole('status').textContent).toBe('2 horarios, martes');
  });

  it('moves with arrows, Home and End, wrapping around', async () => {
    const user = userEvent.setup();
    render(<Host />);
    screen.getByRole('radio', { name: /Martes/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(
      screen
        .getByRole('radio', { name: /Jueves/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(document.activeElement).toBe(
      screen.getByRole('radio', { name: /Jueves/ }),
    );
    await user.keyboard('{End}');
    expect(
      screen.getByRole('radio', { name: /Todos/ }).getAttribute('aria-checked'),
    ).toBe('true');
    await user.keyboard('{ArrowRight}');
    expect(
      screen
        .getByRole('radio', { name: /Martes/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    await user.keyboard('{ArrowLeft}');
    expect(
      screen.getByRole('radio', { name: /Todos/ }).getAttribute('aria-checked'),
    ).toBe('true');
  });
});
