import { NotFoundException } from '@nestjs/common';
import { buildAlarmFixture } from '../alarm/testing.js';
import type { FingerprintsService } from '../fingerprints/fingerprints.service.js';
import { PanelController } from './panel.controller.js';
import { PanelScheduleNotFoundError, PanelService } from './panel.service.js';
import { rosterQuerySchema } from './dto/panel.dto.js';

const bogota = (hhmm: string, date = '2026-11-02') =>
  new Date(`${date}T${hhmm}:00-05:00`);

function build(withFingerprint: string[] = []) {
  const f = buildAlarmFixture(bogota('09:00'));
  const fingerprints = {
    findStudentIdsWithFingerprint: vi.fn(async (ids: string[]) => {
      return new Set(ids.filter((id) => withFingerprint.includes(id)));
    }),
  } as unknown as FingerprintsService;
  const panel = new PanelService(
    f.instances,
    f.schedules,
    f.attendance,
    f.students,
    fingerprints,
    f.service,
    f.clock,
  );
  return { ...f, panel, fingerprints };
}

/** Monday schedule 10:00-11:00 with two students assigned. */
async function withSchedule(f: ReturnType<typeof build>) {
  const detail = await f.weekly('Grupo A', '10:00', '11:00');
  const ana = await f.newStudent('1');
  const beto = await f.newStudent('2');
  await f.schedules.assignStudent(detail.schedule.id, ana.id);
  await f.schedules.assignStudent(detail.schedule.id, beto.id);
  return { scheduleId: detail.schedule.id, ana, beto };
}

describe('PanelService.now (R4)', () => {
  it('has no current schedule and nobody inside before anything starts', async () => {
    const f = build();
    await withSchedule(f);
    f.setNow(bogota('08:00'));

    const now = await f.panel.now();

    expect(now.current).toBeNull();
    expect(now.inside).toEqual([]);
    expect(now.counts).toEqual({
      expected: 0,
      inside: 0,
      exited: 0,
      missing: 0,
    });
    expect(now.serverNow).toBe(bogota('08:00').toISOString());
    expect(now.alarm.on).toBe(false);
  });

  it('lists the assigned students as missing while the schedule runs', async () => {
    const f = build(['placeholder']);
    const { scheduleId, ana } = await withSchedule(f);
    f.setNow(bogota('10:20'));

    const now = await f.panel.now();

    expect(now.current).toMatchObject({
      scheduleId,
      scheduleName: 'Grupo A',
      remainingSeconds: 40 * 60,
      entryOpen: true,
    });
    expect(now.counts).toEqual({
      expected: 2,
      inside: 0,
      exited: 0,
      missing: 2,
    });
    expect(now.missing.map((p) => p.name)).toEqual(['Student 1', 'Student 2']);
    expect(now.missing[0]).toMatchObject({
      studentId: ana.id,
      document: '1',
      hasFingerprint: false,
      enteredAt: null,
    });
  });

  it('moves a student to inside on entry and to exited on exit, with the origin', async () => {
    const f = build();
    const { ana, beto } = await withSchedule(f);
    f.setNow(bogota('10:10'));
    await f.attendance.registerManualEntry(ana.id, 'sin huella');

    let now = await f.panel.now();
    expect(now.counts).toMatchObject({ inside: 1, missing: 1, exited: 0 });
    expect(now.inside[0]).toMatchObject({
      studentId: ana.id,
      source: 'manual',
      sessionStatus: 'abierta',
      enteredAt: bogota('10:10').toISOString(),
    });

    f.setNow(bogota('10:30'));
    await f.attendance.registerManualExit(ana.id, 'salida');
    now = await f.panel.now();
    expect(now.counts).toMatchObject({ inside: 0, exited: 1, missing: 1 });
    expect(now.exited[0]).toMatchObject({
      studentId: ana.id,
      sessionStatus: 'cerrada',
      exitedAt: bogota('10:30').toISOString(),
    });
    expect(now.missing[0]?.studentId).toBe(beto.id);
  });

  it('keeps counting someone removed after entering, and marks unregistered sessions as exited', async () => {
    const f = build(['x']);
    const { scheduleId, ana, beto } = await withSchedule(f);
    f.setNow(bogota('10:10'));
    await f.attendance.registerManualEntry(ana.id, 'a');
    await f.attendance.registerManualEntry(beto.id, 'b');
    await f.schedules.unassignStudent(scheduleId, ana.id);
    const instance = (await f.instancesOf())[0]!;
    await f.attendance.markUnregisteredByInstance(instance.id, 'timeout');

    const now = await f.panel.now();

    expect(now.counts).toEqual({
      expected: 2,
      inside: 0,
      exited: 2,
      missing: 0,
    });
    expect(now.exited.map((p) => p.sessionStatus)).toEqual([
      'no_registrada',
      'no_registrada',
    ]);
  });

  it('shows who is still inside after the schedule ended, with current null', async () => {
    const f = build();
    const { ana } = await withSchedule(f);
    f.setNow(bogota('10:30'));
    await f.attendance.registerManualEntry(ana.id, 'a');
    f.setNow(bogota('11:10'));

    const now = await f.panel.now();

    expect(now.current).toBeNull();
    expect(now.inside.map((p) => p.studentId)).toEqual([ana.id]);
    expect(now.counts.inside).toBe(1);
  });

  it('flags students with a fingerprint', async () => {
    const f = build();
    const { ana } = await withSchedule(f);
    (
      f.fingerprints.findStudentIdsWithFingerprint as ReturnType<typeof vi.fn>
    ).mockResolvedValue(new Set([ana.id]));
    f.setNow(bogota('10:20'));

    const now = await f.panel.now();

    expect(
      now.missing.find((p) => p.studentId === ana.id)?.hasFingerprint,
    ).toBe(true);
    expect(
      now.missing.find((p) => p.studentId !== ana.id)?.hasFingerprint,
    ).toBe(false);
  });
});

describe('PanelService.roster (R5)', () => {
  it('reports attended and missing for a past occurrence', async () => {
    const f = build();
    const { scheduleId, ana, beto } = await withSchedule(f);
    f.setNow(bogota('10:10'));
    await f.attendance.registerManualEntry(ana.id, 'a');
    f.setNow(bogota('12:00'));

    const roster = await f.panel.roster(scheduleId, '2026-11-02');

    expect(roster.phase).toBe('past');
    expect(roster.occurrence).toMatchObject({ date: '2026-11-02' });
    expect(roster.counts).toEqual({ expected: 2, attended: 1, missing: 1 });
    expect(roster.rows.find((r) => r.studentId === ana.id)).toMatchObject({
      state: 'attended',
      assigned: true,
      source: 'manual',
    });
    expect(roster.rows.find((r) => r.studentId === beto.id)?.state).toBe(
      'missing',
    );
  });

  it('keeps a student removed afterwards in the list of a past day', async () => {
    const f = build();
    const { scheduleId, ana } = await withSchedule(f);
    f.setNow(bogota('12:00'));
    await f.schedules.unassignStudent(scheduleId, ana.id);

    const roster = await f.panel.roster(scheduleId, '2026-11-02');
    expect(roster.rows.map((r) => r.studentId)).toContain(ana.id);

    const next = await f.panel.roster(scheduleId, '2026-11-09');
    expect(next.rows.map((r) => r.studentId)).not.toContain(ana.id);
  });

  it('does not list somebody assigned only after the occurrence', async () => {
    const f = build();
    const { scheduleId } = await withSchedule(f);
    f.setNow(bogota('12:00'));
    const late = await f.newStudent('3');
    await f.schedules.assignStudent(scheduleId, late.id);

    const past = await f.panel.roster(scheduleId, '2026-11-02');
    const future = await f.panel.roster(scheduleId, '2026-11-09');

    expect(past.rows.map((r) => r.studentId)).not.toContain(late.id);
    expect(future.rows.map((r) => r.studentId)).toContain(late.id);
  });

  it('marks everyone as expected on a future day', async () => {
    const f = build();
    const { scheduleId } = await withSchedule(f);

    const roster = await f.panel.roster(scheduleId, '2026-11-09');

    expect(roster.phase).toBe('future');
    expect(roster.rows.map((r) => r.state)).toEqual(['expected', 'expected']);
    expect(roster.counts).toEqual({ expected: 2, attended: 0, missing: 0 });
  });

  it('is current while the schedule runs and includes unassigned attendees', async () => {
    const f = build();
    const { scheduleId, ana } = await withSchedule(f);
    f.setNow(bogota('10:10'));
    await f.attendance.registerManualEntry(ana.id, 'a');
    await f.schedules.unassignStudent(scheduleId, ana.id);

    const roster = await f.panel.roster(scheduleId, '2026-11-02');

    expect(roster.phase).toBe('current');
    expect(roster.rows.find((r) => r.studentId === ana.id)).toMatchObject({
      state: 'attended',
      assigned: true,
    });
  });

  it('answers without error when the date has no occurrence', async () => {
    const f = build();
    const { scheduleId } = await withSchedule(f);

    const roster = await f.panel.roster(scheduleId, '2026-11-03');

    expect(roster).toMatchObject({
      occurrence: null,
      phase: null,
      rows: [],
      counts: { expected: 0, attended: 0, missing: 0 },
    });
  });

  it('projects a weekly day beyond the generated horizon, and not a past one', async () => {
    const f = build();
    const { scheduleId } = await withSchedule(f);

    const ahead = await f.panel.roster(scheduleId, '2026-11-16');
    const behind = await f.panel.roster(scheduleId, '2026-10-26');

    expect(ahead.phase).toBe('future');
    expect(ahead.occurrence).toMatchObject({
      instanceId: null,
      startsAt: bogota('10:00', '2026-11-16').toISOString(),
    });
    expect(ahead.rows).toHaveLength(2);
    expect(behind.occurrence).toBeNull();
  });

  it('rejects an unknown schedule', async () => {
    const f = build();
    await expect(
      f.panel.roster('00000000-0000-4000-8000-000000000000', '2026-11-02'),
    ).rejects.toBeInstanceOf(PanelScheduleNotFoundError);
  });
});

describe('PanelController', () => {
  it('maps an unknown schedule to 404 and exposes the fingerprint ids', async () => {
    const f = build();
    const controller = new PanelController(f.panel);
    await expect(
      controller.roster('00000000-0000-4000-8000-000000000000', {
        date: '2026-11-02',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.fingerprints()).resolves.toEqual({
      studentIds: [],
    });
  });

  it('only accepts real calendar dates', () => {
    expect(rosterQuerySchema.safeParse({ date: '2026-11-02' }).success).toBe(
      true,
    );
    for (const date of ['2026-02-31', '02/11/2026', '2026-13-01', '']) {
      expect(rosterQuerySchema.safeParse({ date }).success).toBe(false);
    }
  });
});
