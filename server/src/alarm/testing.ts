import type { ServerMessage } from '@gymtime/shared';
import { AttendanceService } from '../attendance/attendance.service.js';
import { InMemoryAttendanceRepository } from '../attendance/infrastructure/in-memory-attendance.repository.js';
import { DevicesService } from '../devices/devices.service.js';
import type {
  OutboundSender,
  SendResult,
} from '../devices/outbound-sender.service.js';
import { InMemoryDevicesRepository } from '../devices/infrastructure/in-memory-devices.repository.js';
import {
  MONDAY_9AM_BOGOTA,
  buildSchedulesFixture,
} from '../schedules/testing.js';
import type { SyncService } from '../sync/sync.service.js';
import { defaultAlarmConfig, type AlarmConfig } from './alarm.config.js';
import { AlarmService } from './alarm.service.js';
import { InMemoryAlarmRepository } from './infrastructure/in-memory-alarm.repository.js';

export const bogota = (time: string, date = '2026-11-02') =>
  new Date(`${date}T${time.length === 5 ? `${time}:00` : time}-05:00`);

/** Fake device link: records every `alarm.set` and answers `acked`. */
export function fakeAlarmSender() {
  const sent: ServerMessage[] = [];
  const send = vi.fn(
    async (_deviceId: string, message: ServerMessage): Promise<SendResult> => {
      sent.push(message);
      return 'acked';
    },
  );
  return { sender: { send } as unknown as OutboundSender, sent, send };
}

/**
 * Test fixture: alarm on in-memory repositories, the real attendance and
 * schedules services, a controllable clock and a fake outbound sender.
 */
export function buildAlarmFixture(
  start: Date = MONDAY_9AM_BOGOTA,
  config: AlarmConfig = defaultAlarmConfig,
) {
  const sf = buildSchedulesFixture(start);
  const attendanceRepo = new InMemoryAttendanceRepository();
  const attendance = new AttendanceService(
    attendanceRepo,
    {} as SyncService,
    sf.instances,
    sf.students,
    { onInstanceEmptied() {}, onButtonPressed() {} },
    sf.clock,
  );
  const events = new InMemoryAlarmRepository();
  const devices = new DevicesService(new InMemoryDevicesRepository());
  const link = fakeAlarmSender();
  const service = new AlarmService(
    events,
    attendance,
    sf.instances,
    devices,
    link.sender,
    sf.clock,
    config,
  );
  attendance.setAlarmPort(service);

  const instancesOf = () =>
    sf.instancesRepo.findInRange(bogota('00:00'), bogota('23:59'));

  const openSession = (instanceId: string, studentId = 'student-1') =>
    attendanceRepo.create({
      studentId,
      instanceId,
      enteredAt: sf.clock.now(),
      entrySource: 'device',
    });

  return {
    ...sf,
    attendance,
    attendanceRepo,
    events,
    devices,
    link,
    service,
    config,
    markOnline: (deviceId = 'dev') =>
      devices.markOnline(deviceId, 'fw', sf.clock.now()),
    instancesOf,
    openSession,
    /** `alarm.set` payloads sent so far. */
    alarms: () =>
      link.sent.flatMap((message) =>
        message.type === 'alarm.set' ? [message.payload] : [],
      ),
  };
}
