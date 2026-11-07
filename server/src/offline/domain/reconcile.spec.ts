import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import type { Decision } from '../../attendance/domain/decision.js';
import type { RelevantOccurrence } from '../../schedules/instances.service.js';
import {
  checkTs,
  reconcile,
  sortEvents,
  type ReconcileFacts,
  type TsLimits,
} from './reconcile.js';

const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
const limits: TsLimits = {
  futureToleranceSec: 120,
  maxAgeSec: 72 * 3600,
  minTs: new Date('2020-01-01T00:00:00Z'),
};

const occurrence = {
  instance: { id: 'i1' },
} as unknown as RelevantOccurrence;

const entryOk: Decision = { kind: 'entry', occurrence };
const open = { id: 'a1', enteredAt: at('10:05') };

// `now` is far from `ts` on purpose: the server clock must not decide.
const base: ReconcileFacts = {
  kind: 'entry',
  ts: at('10:10'),
  now: at('12:00'),
  limits,
  snapshotKnown: true,
  slotKnown: true,
  lastAppliedTs: null,
  decision: entryOk,
  openSession: null,
  serverClosedSession: false,
};

const denied = (reason: Extract<Decision, { kind: 'denied' }>['reason']) =>
  ({ kind: 'denied', reason }) as Decision;

describe('reconcile (R7, R8, R10, R11)', () => {
  it.each<[string, Partial<ReconcileFacts>, object]>([
    ['a valid entry', {}, { kind: 'entry', occurrence }],
    [
      'an entry while a session is open',
      { decision: { kind: 'exit', session: {} as AttendanceSession } },
      { kind: 'review', reason: 'DUPLICATE_ENTRY' },
    ],
    [
      'an entry in an occurrence the server already closed',
      { serverClosedSession: true },
      { kind: 'review', reason: 'DUPLICATE_ENTRY' },
    ],
    [
      'an entry outside the window',
      { decision: denied('OUTSIDE_ENTRY_WINDOW') },
      { kind: 'review', reason: 'OUTSIDE_WINDOW' },
    ],
    [
      'an entry with no schedule at that instant',
      { decision: denied('NO_ACTIVE_SCHEDULE') },
      { kind: 'review', reason: 'OUTSIDE_WINDOW' },
    ],
    [
      'an entry of a student not in the schedule',
      { decision: denied('NOT_IN_SCHEDULE') },
      { kind: 'review', reason: 'NOT_IN_SCHEDULE' },
    ],
    [
      'an entry after the student already exited',
      { decision: denied('ALREADY_EXITED') },
      { kind: 'review', reason: 'ALREADY_EXITED' },
    ],
    [
      'an entry of an inactive student',
      { decision: denied('STUDENT_INACTIVE') },
      { kind: 'review', reason: 'STUDENT_INACTIVE' },
    ],
    [
      'a valid exit',
      { kind: 'exit', decision: null, openSession: open },
      { kind: 'exit', sessionId: 'a1' },
    ],
    [
      'an exit before the entry it would close',
      { kind: 'exit', decision: null, ts: at('10:01'), openSession: open },
      { kind: 'review', reason: 'OUT_OF_ORDER' },
    ],
    [
      'an exit with no session',
      { kind: 'exit', decision: null },
      { kind: 'review', reason: 'EXIT_WITHOUT_ENTRY' },
    ],
    [
      'an exit over a session the server closed',
      { kind: 'exit', decision: null, serverClosedSession: true },
      { kind: 'review', reason: 'SESSION_ALREADY_CLOSED' },
    ],
    [
      'an event older than one already applied',
      { lastAppliedTs: at('10:20') },
      { kind: 'review', reason: 'OUT_OF_ORDER' },
    ],
    [
      'an event at the same instant as the last applied one',
      { lastAppliedTs: at('10:10') },
      { kind: 'entry', occurrence },
    ],
    [
      'a snapshot the server does not know',
      { snapshotKnown: false },
      { kind: 'review', reason: 'UNKNOWN_SNAPSHOT' },
    ],
    [
      'a slot missing from the snapshot roster',
      { slotKnown: false },
      { kind: 'review', reason: 'UNKNOWN_SLOT' },
    ],
  ])('%s', (_name, over, expected) => {
    expect(reconcile({ ...base, ...over })).toEqual(expected);
  });

  it('checks the instant before anything else', () => {
    const future = { ts: new Date(base.now.getTime() + 121_000) };
    expect(
      reconcile({ ...base, ...future, snapshotKnown: false, slotKnown: false }),
    ).toEqual({ kind: 'review', reason: 'TS_FUTURE' });
  });
});

describe('checkTs (R11)', () => {
  const now = at('12:00');
  it.each<[string, Date, string | null]>([
    ['now', now, null],
    ['exactly the tolerance ahead', new Date(now.getTime() + 120_000), null],
    ['one second beyond it', new Date(now.getTime() + 121_000), 'TS_FUTURE'],
    ['a minute ago', new Date(now.getTime() - 60_000), null],
    ['exactly the maximum age', new Date(now.getTime() - 72 * 3600_000), null],
    [
      'a second older than that',
      new Date(now.getTime() - 72 * 3600_000 - 1000),
      'TS_TOO_OLD',
    ],
    ['before 2020 (a reader that lost its clock)', new Date(0), 'TS_TOO_OLD'],
  ])('%s', (_name, ts, expected) => {
    expect(checkTs(ts, now, limits)).toBe(expected);
  });

  it('honours custom limits', () => {
    const custom = { ...limits, futureToleranceSec: 10, maxAgeSec: 60 };
    expect(checkTs(new Date(now.getTime() + 11_000), now, custom)).toBe(
      'TS_FUTURE',
    );
    expect(checkTs(new Date(now.getTime() - 61_000), now, custom)).toBe(
      'TS_TOO_OLD',
    );
  });
});

describe('sortEvents (R7)', () => {
  it('orders by ts, then seq, then id', () => {
    const events = [
      { id: 'c', ts: at('10:10'), seq: 3 },
      { id: 'b', ts: at('10:10'), seq: 2 },
      { id: 'a', ts: at('10:05'), seq: 9 },
      { id: 'd', ts: at('10:10'), seq: 2 },
    ];
    expect(sortEvents(events).map((e) => e.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(events[0]?.id).toBe('c');
  });
});
