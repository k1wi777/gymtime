import { auditDot, withDayHeaders } from '@/features/admin/audit-days';
import { periodTimeline } from '@/lib/timeline';
import { formatShortDay } from '@/lib/time';
import {
  peakDatesSeries,
  peakHoursSeries,
} from '@/features/reportes/flow-series';
import type { FlowReport } from '@/api/types';

describe('periodTimeline', () => {
  const period = {
    startDate: '2026-08-01',
    endDate: '2026-08-10',
    exceptions: [
      { id: 'e1', from: '2026-08-03', to: '2026-08-04', reason: 'Festivo' },
      { id: 'e2', from: '2026-08-08', to: '2026-08-08', reason: 'Parada' },
      { id: 'e3', from: '2026-09-01', to: '2026-09-02', reason: 'Fuera' },
    ],
  } as never;

  it('places today and the elapsed part proportionally to the days', () => {
    const line = periodTimeline(period, '2026-08-06');
    expect(line.todayAt).toBe(50);
    expect(line.progress).toBe(50);
  });

  it('draws ranges with width, single days as a tick and skips outside ones', () => {
    const { marks } = periodTimeline(period, '2026-08-06');
    expect(marks.map((m) => m.id)).toEqual(['e1', 'e2']);
    expect(marks[0]).toMatchObject({ left: 20, width: 20 });
    expect(marks[1]?.width).toBeNull();
  });

  it('has no «today» outside the period', () => {
    expect(periodTimeline(period, '2026-07-01')).toMatchObject({
      todayAt: null,
      progress: 0,
    });
    expect(periodTimeline(period, '2026-12-01')).toMatchObject({
      todayAt: null,
      progress: 100,
    });
  });
});

describe('audit days', () => {
  it('labels only the first row of each day', () => {
    const rows = withDayHeaders(['a1', 'a2', 'b1', 'a3'], (x) => x[0] ?? '');
    expect(rows.map((r) => r.day)).toEqual(['a', null, 'b', 'a']);
  });

  it('gives a color per kind of event and a neutral one for others', () => {
    expect(auditDot('auth.login')).toBe('#0b6a96');
    expect(auditDot('alarm.on')).toBe('#d4780a');
    expect(auditDot('x.y')).toBe('#6b6660');
  });
});

describe('formatShortDay', () => {
  it('writes the day and the month without «de»', () => {
    expect(formatShortDay('2026-09-07')).toBe('7 sept');
  });
});

describe('peak-only series', () => {
  const flow = {
    total: 100,
    peaks: {
      hours: [
        { hour: 7, count: 30 },
        { hour: 6, count: 54 },
        { hour: 8, count: 54 },
      ],
      dates: [
        { date: '2026-09-01', count: 10 },
        { date: '2026-09-02', count: 20 },
      ],
    },
  } as unknown as FlowReport;

  it('flags only the highest bar with the accent', () => {
    expect(peakHoursSeries(flow).map((d) => d.peak)).toEqual([
      true,
      false,
      true,
    ]);
    expect(peakDatesSeries(flow).map((d) => d.peak)).toEqual([false, true]);
  });
});
