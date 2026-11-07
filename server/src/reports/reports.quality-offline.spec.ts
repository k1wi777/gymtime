import { describe, expect, it } from 'vitest';
import { computeQuality } from './domain/quality.js';
import { buildReportsFixture } from './testing.js';
import { ReportsService } from './reports.service.js';
import type { OfflineReviewService } from '../offline/offline-review.service.js';

describe('quality report: offline mode (H12)', () => {
  it('appends the offline rows and carries the numbers in meta', async () => {
    const fixture = buildReportsFixture({ dataset: 'semester' });
    const windows: { from: Date; to: Date }[] = [];
    const offline = {
      outcomeCounts: async (w: { from: Date; to: Date }) => {
        windows.push(w);
        return { reconciled: 3, pending: 2, discarded: 1 };
      },
    } as unknown as OfflineReviewService;
    const reports = new ReportsService(
      fixture.students,
      fixture.schedules,
      fixture.instances,
      fixture.periods,
      fixture.attendance,
      fixture.service,
      fixture.devices,
      fixture.eventLogService,
      fixture.clock,
      offline,
    );
    const table = await reports.quality({});
    // With offline events the extra rows are appended; the first four stay.
    expect(table.rows).toHaveLength(8);
    expect(table.rows.slice(4).map((r) => r.count)).toEqual([0, 3, 2, 1]);
    expect(table.rows[5]!.share).toBeNull();
    expect(table.meta.offline).toEqual({
      sessions: 0,
      reconciled: 3,
      pending: 2,
      discarded: 1,
    });
    expect(windows).toHaveLength(1);
    expect(windows[0]!.from.getTime()).toBeLessThan(windows[0]!.to.getTime());
  });

  it('without the offline service the counts are zero', async () => {
    const fixture = buildReportsFixture({ dataset: 'semester' });
    const table = await fixture.reports.quality({});
    expect(table.rows).toHaveLength(4);
    expect(table.meta.offline).toEqual({
      sessions: 0,
      reconciled: 0,
      pending: 0,
      discarded: 0,
    });
  });

  it('an empty list has no offline sessions', () => {
    const table = computeQuality([], {
      now: new Date(),
      instances: new Map(),
    } as never);
    expect(table.meta.offline).toMatchObject({ sessions: 0 });
  });
});
