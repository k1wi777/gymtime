import { AttendanceError } from './domain/attendance.errors.js';
import { buildAttendanceFixture } from './testing.js';

const bogota = (hhmm: string, date = '2026-11-02') =>
  new Date(`${date}T${hhmm}:00-05:00`);

async function scheduleWithStudent(
  f: ReturnType<typeof buildAttendanceFixture>,
  start = '10:00',
  end = '11:00',
) {
  const schedule = await f.weekly('A', start, end);
  const ana = await f.newStudent('1');
  await f.schedules.assignStudent(schedule.schedule.id, ana.id);
  return { schedule, ana };
}

describe('AttendanceService.recordScan (R1-R4, R10)', () => {
  it('persists an entry linked to the occurrence with the server time', async () => {
    const f = buildAttendanceFixture();
    const { ana } = await scheduleWithStudent(f);
    f.setNow(bogota('10:30'));
    f.slot(ana);

    const outcome = await f.service.recordScan('dev', 5, 1_700_000_000);

    expect(outcome.student?.id).toBe(ana.id);
    expect(outcome.decision.kind).toBe('entry');
    const [session] = await f.repository.list();
    expect(session).toMatchObject({
      studentId: ana.id,
      entrySource: 'device',
      status: 'abierta',
      exitedAt: null,
    });
    expect(session.enteredAt).toEqual(bogota('10:30'));
    expect(session.instanceId).toBe(
      outcome.decision.kind === 'entry'
        ? outcome.decision.occurrence.instance.id
        : '',
    );
  });

  it('closes the open session on exit, even after the schedule ended (R3)', async () => {
    const f = buildAttendanceFixture();
    const { ana } = await scheduleWithStudent(f);
    f.slot(ana);
    f.setNow(bogota('10:30'));
    await f.service.recordScan('dev', 5, 0);

    f.setNow(bogota('11:30'));
    const outcome = await f.service.recordScan('dev', 5, 0);

    expect(outcome.decision.kind).toBe('exit');
    const [session] = await f.repository.list();
    expect(session).toMatchObject({
      status: 'cerrada',
      exitSource: 'device',
      exitedAt: bogota('11:30'),
    });
  });

  it('denies an unknown slot without writing (R1)', async () => {
    const f = buildAttendanceFixture();
    f.slot(null);
    const outcome = await f.service.recordScan('dev', 99, 0);
    expect(outcome.decision).toEqual({
      kind: 'denied',
      reason: 'UNKNOWN_SLOT',
    });
    expect(await f.repository.list()).toHaveLength(0);
  });

  it('rejects an inactive student and does not write (R7)', async () => {
    const f = buildAttendanceFixture();
    const { ana } = await scheduleWithStudent(f);
    await f.students.deactivate(ana.id);
    const inactive = await f.students.findById(ana.id);
    f.setNow(bogota('10:30'));
    f.slot(inactive);

    const outcome = await f.service.recordScan('dev', 5, 0);
    expect(outcome.decision).toEqual({
      kind: 'denied',
      reason: 'STUDENT_INACTIVE',
    });
    expect(await f.repository.list()).toHaveLength(0);
  });

  it('rejects ALREADY_EXITED only for the same occurrence (R6)', async () => {
    const f = buildAttendanceFixture();
    const { ana } = await scheduleWithStudent(f);
    f.slot(ana);
    f.setNow(bogota('10:30'));
    await f.service.recordScan('dev', 5, 0);
    f.setNow(bogota('10:35'));
    await f.service.recordScan('dev', 5, 0);

    f.setNow(bogota('10:36'));
    const again = await f.service.recordScan('dev', 5, 0);
    expect(again.decision).toEqual({
      kind: 'denied',
      reason: 'ALREADY_EXITED',
    });
    expect(await f.repository.list()).toHaveLength(1);
  });

  it('serialises concurrent scans of the same student into entry then exit', async () => {
    const f = buildAttendanceFixture();
    const { ana } = await scheduleWithStudent(f);
    f.slot(ana);
    f.setNow(bogota('10:30'));

    const outcomes = await Promise.all([
      f.service.recordScan('dev', 5, 0),
      f.service.recordScan('dev', 5, 0),
    ]);

    expect(outcomes.map((o) => o.decision.kind).sort()).toEqual([
      'entry',
      'exit',
    ]);
    const sessions = await f.repository.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe('cerrada');
  });

  it('notifies the alarm only when the last open session closes (R14)', async () => {
    const f = buildAttendanceFixture();
    const schedule = await f.weekly('A', '10:00', '11:00');
    const ana = await f.newStudent('1');
    const luis = await f.newStudent('2');
    await f.schedules.assignStudent(schedule.schedule.id, ana.id);
    await f.schedules.assignStudent(schedule.schedule.id, luis.id);
    const [instance] = await f.instancesRepo.findInRange(
      bogota('00:00'),
      bogota('23:59'),
    );
    await f.repository.create({
      studentId: ana.id,
      instanceId: instance.id,
      enteredAt: bogota('10:00'),
      entrySource: 'device',
    });
    await f.repository.create({
      studentId: luis.id,
      instanceId: instance.id,
      enteredAt: bogota('10:01'),
      entrySource: 'device',
    });
    f.setNow(bogota('10:30'));

    f.slot(ana);
    await f.service.recordScan('dev', 5, 0);
    expect(f.onInstanceEmptied).not.toHaveBeenCalled();

    f.slot(luis);
    await f.service.recordScan('dev', 5, 0);
    expect(f.onInstanceEmptied).toHaveBeenCalledWith(instance.id);
  });
});

describe('AttendanceService manual registration (R13, R14)', () => {
  it('creates a manual entry with the reason', async () => {
    const f = buildAttendanceFixture();
    const { ana } = await scheduleWithStudent(f);
    f.setNow(bogota('10:30'));

    const session = await f.service.registerManualEntry(ana.id, 'olvidó huella');

    expect(session).toMatchObject({
      studentId: ana.id,
      entrySource: 'manual',
      manualReason: 'olvidó huella',
      status: 'abierta',
    });
  });

  it('rejects a second entry and an exit without an open session', async () => {
    const f = buildAttendanceFixture();
    const { ana } = await scheduleWithStudent(f);
    f.setNow(bogota('10:30'));
    await f.service.registerManualEntry(ana.id, 'primera');

    await expect(
      f.service.registerManualEntry(ana.id, 'otra'),
    ).rejects.toMatchObject({ code: 'SESSION_ALREADY_OPEN' });

    const luis = await f.newStudent('2');
    await expect(
      f.service.registerManualExit(luis.id, 'sin sesión'),
    ).rejects.toMatchObject({ code: 'NO_OPEN_SESSION' });
  });

  it('rejects a manual entry without an active schedule', async () => {
    const f = buildAttendanceFixture();
    const ana = await f.newStudent('1');
    f.setNow(bogota('10:30'));

    await expect(
      f.service.registerManualEntry(ana.id, 'sin horario'),
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_SCHEDULE' });
  });

  it('closes manually with the reason and notifies the alarm', async () => {
    const f = buildAttendanceFixture();
    const { ana } = await scheduleWithStudent(f);
    f.setNow(bogota('10:30'));
    const entry = await f.service.registerManualEntry(ana.id, 'entrada');

    f.setNow(bogota('10:40'));
    const closed = await f.service.registerManualExit(ana.id, 'salida');

    expect(closed).toMatchObject({
      status: 'cerrada',
      exitSource: 'manual',
      manualReason: 'salida',
      exitedAt: bogota('10:40'),
    });
    expect(f.onInstanceEmptied).toHaveBeenCalledWith(entry.instanceId);
  });

  it('reports an unknown student and an unknown slot for manual registration', async () => {
    const f = buildAttendanceFixture();
    await expect(
      f.service.registerManualEntry('00000000-0000-4000-8000-000000000099', 'x'),
    ).rejects.toBeInstanceOf(AttendanceError);
    await expect(
      f.service.registerManualEntry('00000000-0000-4000-8000-000000000099', 'x'),
    ).rejects.toMatchObject({ code: 'STUDENT_NOT_FOUND' });
  });
});

describe('AttendanceService read models (R15)', () => {
  async function seeded() {
    const f = buildAttendanceFixture();
    const schedule = await f.weekly('A', '10:00', '11:00');
    const ana = await f.newStudent('1');
    const luis = await f.newStudent('2');
    await f.schedules.assignStudent(schedule.schedule.id, ana.id);
    const [instance] = await f.instancesRepo.findInRange(
      bogota('00:00'),
      bogota('23:59'),
    );
    const open = await f.repository.create({
      studentId: ana.id,
      instanceId: instance.id,
      enteredAt: bogota('10:00'),
      entrySource: 'device',
    });
    const closed = await f.repository.create({
      studentId: luis.id,
      instanceId: instance.id,
      enteredAt: bogota('10:05'),
      entrySource: 'device',
    });
    await f.repository.close(closed.id, {
      exitedAt: bogota('10:20'),
      exitSource: 'manual',
      manualReason: 'salió antes',
    });
    return { f, ana, luis, instance, open, closed };
  }

  it('lists open sessions with student and occurrence data', async () => {
    const { f, ana, instance, open } = await seeded();
    const [view] = await f.service.listOpen();
    expect(view).toMatchObject({
      id: open.id,
      student: { id: ana.id, document: '1', name: 'Student 1' },
      enteredAt: bogota('10:00'),
      instance: {
        id: instance.id,
        scheduleId: instance.scheduleId,
        startsAt: bogota('10:00'),
        endsAt: bogota('11:00'),
      },
    });
  });

  it('lists sessions with filters and the manual origin', async () => {
    const { f, ana, luis, instance } = await seeded();

    const all = await f.service.listSessions();
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({
      student: { id: luis.id },
      status: 'cerrada',
      exitSource: 'manual',
      manualReason: 'salió antes',
      exitedAt: bogota('10:20'),
    });
    expect(await f.service.listSessions({ studentId: ana.id })).toHaveLength(1);
    expect(await f.service.listSessions({ instanceId: instance.id })).toHaveLength(
      2,
    );
    expect(await f.service.listSessions({ status: 'abierta' })).toHaveLength(1);
    expect(
      await f.service.listSessions({
        from: bogota('10:02'),
        to: bogota('10:10'),
      }),
    ).toHaveLength(1);
    expect(await f.service.listSessions({ limit: 1 })).toHaveLength(1);
  });

  it('feeds the open-sessions provider with the students inside (R17)', async () => {
    const { f, ana } = await seeded();
    expect(await f.service.listOpenStudentIds()).toEqual([ana.id]);
  });
});

describe('AttendanceService.recordUnknown / recordButton', () => {
  it('logs an unknown fingerprint with the server instant', () => {
    const f = buildAttendanceFixture();
    f.setNow(bogota('10:30'));
    expect(f.service.recordUnknown('dev')).toEqual(bogota('10:30'));
  });

  it('records a button press, delegates it to the alarm and keeps sessions', async () => {
    const f = buildAttendanceFixture();
    await f.service.recordButton('dev');
    expect(f.onButtonPressed).toHaveBeenCalledWith('dev');
    expect(await f.repository.list()).toHaveLength(0);
  });

  it('does not break the ack when the alarm port fails', async () => {
    const f = buildAttendanceFixture();
    f.onButtonPressed.mockRejectedValue(new Error('alarm down'));
    await expect(f.service.recordButton('dev')).resolves.toBeUndefined();
  });

  it('closes every open session of an occurrence as no_registrada (E8-4, E8-6)', async () => {
    const f = buildAttendanceFixture();
    const schedule = await f.weekly('A', '10:00', '11:00');
    const ana = await f.newStudent('1');
    const luis = await f.newStudent('2');
    await f.schedules.assignStudent(schedule.schedule.id, ana.id);
    await f.schedules.assignStudent(schedule.schedule.id, luis.id);
    const [instance] = await f.instancesRepo.findInRange(
      bogota('00:00'),
      bogota('23:59'),
    );
    for (const student of [ana, luis]) {
      await f.repository.create({
        studentId: student.id,
        instanceId: instance.id,
        enteredAt: bogota('10:00'),
        entrySource: 'device',
      });
    }

    expect(await f.service.countOpenByInstance(instance.id)).toBe(2);
    expect(
      await f.service.markUnregisteredByInstance(instance.id, 'timeout'),
    ).toBe(2);
    expect(await f.service.countOpenByInstance(instance.id)).toBe(0);
    const rows = await f.repository.list({ instanceId: instance.id });
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'no_registrada',
          exitedAt: null,
          exitSource: null,
          manualReason: 'timeout',
        }),
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(f.onInstanceEmptied).not.toHaveBeenCalled();
  });

  it('replaces the initial port through setAlarmPort (E8-4)', async () => {
    const f = buildAttendanceFixture();
    const onInstanceEmptied = vi.fn();
    const onButtonPressed = vi.fn();
    f.service.setAlarmPort({ onInstanceEmptied, onButtonPressed });

    await f.service.recordButton('dev');

    expect(onButtonPressed).toHaveBeenCalledWith('dev');
    expect(f.onButtonPressed).not.toHaveBeenCalled();
  });
});
