import type { ServerMessage } from '@gymtime/shared';
import { AttendanceService } from '../attendance/attendance.service.js';
import { InMemoryAttendanceRepository } from '../attendance/infrastructure/in-memory-attendance.repository.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import { DevicesService } from '../devices/devices.service.js';
import { DisplayService } from '../devices/display.service.js';
import { testDisplayConfig } from '../students/testing.js';
import type {
  OutboundSender,
  SendCommandOptions,
  SendResult,
} from '../devices/outbound-sender.service.js';
import { InMemoryDeviceCommandsRepository } from '../devices/infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from '../devices/infrastructure/in-memory-devices.repository.js';
import {
  MONDAY_9AM_BOGOTA,
  buildSchedulesFixture,
} from '../schedules/testing.js';
import type { SyncService } from '../sync/sync.service.js';
import { defaultAlarmConfig, type AlarmConfig } from './alarm.config.js';
import { AlarmService } from './alarm.service.js';
import { InMemoryAlarmRepository } from './infrastructure/in-memory-alarm.repository.js';
import { SystemEventsService } from '../common/events/system-events.service.js';

export const bogota = (time: string, date = '2026-11-02') =>
  new Date(`${date}T${time.length === 5 ? `${time}:00` : time}-05:00`);

/** Fake device link: records every `alarm.set` and answers `acked`. */
export function fakeAlarmSender() {
  const sent: ServerMessage[] = [];
  const send = vi.fn(
    async (
      _deviceId: string,
      message: ServerMessage,
      _options?: SendCommandOptions,
    ): Promise<SendResult> => {
      sent.push(message);
      return 'acked';
    },
  );
  return {
    sender: { send, sendCommand: send } as unknown as OutboundSender,
    sent,
    send,
  };
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
  const systemEvents = new SystemEventsService();
  const attendance = new AttendanceService(
    attendanceRepo,
    {} as SyncService,
    sf.instances,
    sf.students,
    { onInstanceEmptied() {}, onButtonPressed() {} },
    sf.clock,
    new EventLogService(sf.eventLogRepo),
    systemEvents,
  );
  const events = new InMemoryAlarmRepository();
  const devices = new DevicesService(
    new InMemoryDevicesRepository(),
    new InMemoryDeviceCommandsRepository(),
  );
  const link = fakeAlarmSender();
  const eventLog = new EventLogService(sf.eventLogRepo);
  const display = new DisplayService(
    devices,
    link.sender,
    eventLog,
    testDisplayConfig,
  );
  const service = new AlarmService(
    events,
    attendance,
    sf.instances,
    devices,
    link.sender,
    systemEvents,
    display,
    eventLog,
    sf.clock,
    config,
  );
  attendance.setAlarmPort(service);

  /** A new service on the same state: simulates a server restart. */
  const restart = () =>
    new AlarmService(
      events,
      attendance,
      sf.instances,
      devices,
      link.sender,
      systemEvents,
      display,
      eventLog,
      sf.clock,
      config,
    );

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
    restart,
    eventLog: sf.eventLogRepo,
    systemEvents,
    config,
    markOnline: (deviceId = 'dev') =>
      devices.markOnline(deviceId, 'fw', sf.clock.now()),
    instancesOf,
    openSession,
    /** `display.message` payloads sent so far. */
    messages: () =>
      link.sent.flatMap((message) =>
        message.type === 'display.message' ? [message.payload] : [],
      ),
    /** `alarm.set` payloads sent so far. */
    alarms: () =>
      link.sent.flatMap((message) =>
        message.type === 'alarm.set' ? [message.payload] : [],
      ),
  };
}
