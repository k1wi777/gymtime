import { occurrenceDates } from './occurrence-dates.js';

const period = { startDate: '2026-11-02', endDate: '2026-11-30' };
const window = { from: '2026-11-02', to: '2027-01-31' };

describe('occurrenceDates (E18-3)', () => {
  it('lists every matching weekday of the period, not beyond it', () => {
    expect(
      occurrenceDates({ weekday: 1, date: null }, period, [], window),
    ).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
  });

  it('skips the days without service (a holiday in a Monday-to-Friday run)', () => {
    const days = [1, 2, 3, 4, 5].flatMap((weekday) =>
      occurrenceDates(
        { weekday, date: null },
        period,
        [{ from: '2026-11-16', to: '2026-11-16' }],
        { from: '2026-11-09', to: '2026-11-20' },
      ),
    );
    expect(days).toContain('2026-11-17');
    expect(days).not.toContain('2026-11-16');
    expect(days).toHaveLength(9);
  });

  it('skips a whole range of days without service', () => {
    expect(
      occurrenceDates(
        { weekday: 3, date: null },
        period,
        [{ from: '2026-11-10', to: '2026-11-20' }],
        window,
      ),
    ).toEqual(['2026-11-04', '2026-11-25']);
  });

  it('starts at the window, not before', () => {
    expect(
      occurrenceDates({ weekday: 1, date: null }, period, [], {
        from: '2026-11-10',
        to: '2026-11-24',
      }),
    ).toEqual(['2026-11-16', '2026-11-23']);
  });

  it('ignores the period and its days without service for a one-off schedule (E18-6)', () => {
    expect(
      occurrenceDates(
        { weekday: null, date: '2026-11-16' },
        period,
        [{ from: '2026-11-16', to: '2026-11-16' }],
        window,
      ),
    ).toEqual(['2026-11-16']);
    expect(
      occurrenceDates({ weekday: null, date: '2026-12-25' }, null, [], window),
    ).toEqual(['2026-12-25']);
    expect(
      occurrenceDates({ weekday: null, date: '2026-10-01' }, null, [], window),
    ).toEqual([]);
  });

  it('uses only the window for a legacy recurring schedule', () => {
    expect(
      occurrenceDates({ weekday: 1, date: null }, null, [], {
        from: '2026-11-02',
        to: '2026-11-04',
      }),
    ).toEqual(['2026-11-02']);
  });
});
