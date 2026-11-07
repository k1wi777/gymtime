import type { AlarmEvent } from '../../alarm/domain/alarm-event.js';
import type { AttendanceSession } from '../../attendance/domain/attendance-session.js';
import { fromBogota } from '../../common/time/bogota.js';
import type { Schedule } from '../../schedules/domain/schedule.js';
import type { ScheduleInstance } from '../../schedules/domain/schedule-instance.js';
import type { ScheduleAssignment } from '../../schedules/domain/schedules.repository.js';
import type { ReportContext, StudentInfo } from './context.js';

/** Small builders for the metric specs; ids are readable strings, not UUIDs. */
export const at = (date: string, time: string): Date => fromBogota(date, time);

export function schedule(over: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sch',
    name: 'Lunes 6am',
    weekday: 1,
    date: null,
    startTime: '06:00:00',
    endTime: '07:00:00',
    entryOpenMinutes: null,
    entryCloseMinutes: null,
    periodId: 'per',
    ...over,
  };
}

export function instance(
  id: string,
  date: string,
  over: Partial<ScheduleInstance> & { start?: string; end?: string } = {},
): ScheduleInstance {
  const { start = '06:00', end = '07:00', ...rest } = over;
  return {
    id,
    scheduleId: 'sch',
    date,
    startsAt: at(date, start),
    endsAt: at(date, end),
    status: 'scheduled',
    ...rest,
  };
}

let sessionCounter = 0;

export function session(
  over: Partial<AttendanceSession> & Pick<AttendanceSession, 'instanceId'>,
): AttendanceSession {
  return {
    id: `s-${++sessionCounter}`,
    studentId: 'ana',
    enteredAt: new Date(0),
    exitedAt: null,
    entrySource: 'device',
    exitSource: null,
    status: 'abierta',
    manualReason: null,
    ...over,
  };
}

export function interval(
  studentId: string,
  validFrom: Date,
  validTo: Date | null = null,
  scheduleId = 'sch',
): ScheduleAssignment {
  return {
    id: `a-${studentId}-${validFrom.getTime()}`,
    scheduleId,
    studentId,
    validFrom,
    validTo,
  };
}

export function alarmEvent(over: Partial<AlarmEvent>): AlarmEvent {
  return {
    id: 'al',
    instanceId: 'i1',
    startedAt: new Date(0),
    endedAt: null,
    closedBy: null,
    closedSessions: 0,
    origin: 'server',
    deviceId: null,
    deviceEventId: null,
    ...over,
  };
}

export function context(
  instances: ScheduleInstance[],
  now: Date,
  students: StudentInfo[] = [
    { id: 'ana', name: 'Ana', program: 'Ingeniería' },
    { id: 'beto', name: 'Beto', program: null },
  ],
): ReportContext {
  return {
    now,
    instances: new Map(instances.map((i) => [i.id, i])),
    schedules: new Map([['sch', schedule()]]),
    students: new Map(students.map((s) => [s.id, s])),
  };
}
