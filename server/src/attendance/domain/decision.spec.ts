import type { RelevantOccurrence } from '../../schedules/instances.service.js';
import type { Student } from '../../students/domain/student.js';
import type { AttendanceSession } from './attendance-session.js';
import { decide } from './decision.js';

const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);

const student = (over: Partial<Student> = {}): Student => ({
  id: 's1',
  document: '1',
  name: 'Ana',
  program: null,
  email: null,
  phone: null,
  displayName: 'Ana',
  active: true,
  consented: true,
  ...over,
});

const session = (over: Partial<AttendanceSession> = {}): AttendanceSession => ({
  id: 'a1',
  studentId: 's1',
  instanceId: 'i1',
  enteredAt: at('10:00'),
  exitedAt: null,
  entrySource: 'device',
  exitSource: null,
  status: 'abierta',
  manualReason: null,
  ...over,
});

const occurrence = (
  id: string,
  start: string,
  end: string,
  open: string,
  close: string,
  studentIds: string[] = ['s1'],
): RelevantOccurrence => ({
  instance: {
    id,
    scheduleId: `sch-${id}`,
    date: '2026-11-02',
    startsAt: at(start),
    endsAt: at(end),
    status: 'scheduled',
  },
  schedule: {
    id: `sch-${id}`,
    name: id,
    weekday: 1,
    date: null,
    startTime: start,
    endTime: end,
    entryOpenMinutes: null,
    entryCloseMinutes: null,
  },
  window: { opensAt: at(open), closesAt: at(close) },
  studentIds,
});

const base = {
  student: student(),
  at: at('10:30'),
  activeOccurrences: [] as RelevantOccurrence[],
  openSession: null as AttendanceSession | null,
  closedInstanceIds: [] as string[],
};

describe('decide (R1, R5-R7)', () => {
  it('denies an unknown slot without any other check', () => {
    expect(
      decide({ ...base, student: null, openSession: session() }),
    ).toEqual({ kind: 'denied', reason: 'UNKNOWN_SLOT' });
  });

  it('registers the exit first, even after the end or when inactive (R3)', () => {
    const open = session();
    expect(
      decide({
        ...base,
        student: student({ active: false }),
        at: at('23:00'),
        openSession: open,
      }),
    ).toEqual({ kind: 'exit', session: open });
  });

  it('denies an inactive student without an open session', () => {
    expect(
      decide({ ...base, student: student({ active: false }) }),
    ).toEqual({ kind: 'denied', reason: 'STUDENT_INACTIVE' });
  });

  it('denies when no occurrence is active', () => {
    expect(decide(base)).toEqual({
      kind: 'denied',
      reason: 'NO_ACTIVE_SCHEDULE',
    });
  });

  it('denies when the student is not in any active occurrence', () => {
    expect(
      decide({
        ...base,
        activeOccurrences: [
          occurrence('i1', '10:00', '11:00', '09:50', '10:55', ['other']),
        ],
      }),
    ).toEqual({ kind: 'denied', reason: 'NOT_IN_SCHEDULE' });
  });

  it('reports ALREADY_EXITED before OUTSIDE_ENTRY_WINDOW (R6)', () => {
    const active = [occurrence('i1', '10:00', '11:00', '09:50', '10:55')];
    expect(
      decide({
        ...base,
        at: at('10:57'),
        activeOccurrences: active,
        closedInstanceIds: ['i1'],
      }),
    ).toEqual({ kind: 'denied', reason: 'ALREADY_EXITED' });
    expect(
      decide({ ...base, at: at('10:57'), activeOccurrences: active }),
    ).toEqual({ kind: 'denied', reason: 'OUTSIDE_ENTRY_WINDOW' });
  });

  it('registers the entry inside the window, even before the start (R4)', () => {
    const active = [occurrence('i1', '10:00', '11:00', '09:50', '10:55')];
    expect(
      decide({ ...base, at: at('09:55'), activeOccurrences: active }),
    ).toMatchObject({ kind: 'entry', occurrence: { instance: { id: 'i1' } } });
    expect(
      decide({ ...base, at: at('10:30'), activeOccurrences: active }),
    ).toMatchObject({ kind: 'entry', occurrence: { instance: { id: 'i1' } } });
  });

  it('limits ALREADY_EXITED to the applicable occurrence (R6, R8)', () => {
    const first = occurrence('i1', '10:00', '11:00', '09:50', '10:55');
    const second = occurrence('i2', '11:00', '12:00', '10:50', '11:55');
    expect(
      decide({
        ...base,
        at: at('10:52'),
        activeOccurrences: [first, second],
        closedInstanceIds: ['i1'],
      }),
    ).toMatchObject({ kind: 'entry', occurrence: { instance: { id: 'i2' } } });
  });

  it('resolves each student of two back-to-back schedules to its own occurrence (R8)', () => {
    const first = occurrence('i1', '10:00', '11:00', '09:50', '10:55');
    const second = occurrence('i2', '11:00', '12:00', '10:50', '11:55');
    expect(
      decide({ ...base, at: at('10:52'), activeOccurrences: [first, second] }),
    ).toMatchObject({ kind: 'entry', occurrence: { instance: { id: 'i2' } } });
    const onlyFirst = occurrence('i1', '10:00', '11:00', '09:50', '10:55', [
      's1',
    ]);
    expect(
      decide({
        ...base,
        at: at('10:52'),
        activeOccurrences: [onlyFirst],
      }),
    ).toMatchObject({ kind: 'entry', occurrence: { instance: { id: 'i1' } } });
  });

  it('falls back to the earliest occurrence when entry is closed in all', () => {
    const first = occurrence('i1', '09:00', '10:00', '08:50', '09:55');
    const second = occurrence('i2', '10:00', '11:00', '09:50', '10:55');
    expect(
      decide({ ...base, at: at('10:57'), activeOccurrences: [first, second] }),
    ).toEqual({ kind: 'denied', reason: 'OUTSIDE_ENTRY_WINDOW' });
  });
});
