import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import type { ServerMessage } from '@gymtime/shared';
import { DeviceClient } from '@gymtime/simulator';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import {
  ALARM_CONFIG,
  defaultAlarmConfig,
  type AlarmConfig,
} from '../../src/alarm/alarm.config.js';
import { AlarmService } from '../../src/alarm/alarm.service.js';
import { ALARM_REPOSITORY } from '../../src/alarm/domain/alarm.repository.js';
import { InMemoryAlarmRepository } from '../../src/alarm/infrastructure/in-memory-alarm.repository.js';
import { ATTENDANCE_REPOSITORY } from '../../src/attendance/domain/attendance.repository.js';
import { InMemoryAttendanceRepository } from '../../src/attendance/infrastructure/in-memory-attendance.repository.js';
import { CLOCK, type Clock } from '../../src/common/time/clock.js';
import {
  DEVICES_CONFIG,
  defaultDevicesConfig,
  type DevicesConfig,
} from '../../src/devices/devices.config.js';
import { DEVICE_COMMANDS_REPOSITORY } from '../../src/devices/domain/device-commands.repository.js';
import { DEVICES_REPOSITORY } from '../../src/devices/domain/devices.repository.js';
import { PROCESSED_MESSAGES_REPOSITORY } from '../../src/devices/domain/processed-messages.repository.js';
import { InMemoryDeviceCommandsRepository } from '../../src/devices/infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from '../../src/devices/infrastructure/in-memory-devices.repository.js';
import { InMemoryProcessedMessagesRepository } from '../../src/devices/infrastructure/in-memory-processed-messages.repository.js';
import {
  FINGERPRINTS_CONFIG,
  defaultFingerprintsConfig,
} from '../../src/fingerprints/fingerprints.config.js';
import { ENROLLMENTS_REPOSITORY } from '../../src/fingerprints/domain/enrollments.repository.js';
import { FINGERPRINTS_REPOSITORY } from '../../src/fingerprints/domain/fingerprints.repository.js';
import { InMemoryEnrollmentsRepository } from '../../src/fingerprints/infrastructure/in-memory-enrollments.repository.js';
import { InMemoryFingerprintsRepository } from '../../src/fingerprints/infrastructure/in-memory-fingerprints.repository.js';
import { INSTANCES_REPOSITORY } from '../../src/schedules/domain/instances.repository.js';
import { SCHEDULES_REPOSITORY } from '../../src/schedules/domain/schedules.repository.js';
import { InMemoryInstancesRepository } from '../../src/schedules/infrastructure/in-memory-instances.repository.js';
import { InMemorySchedulesRepository } from '../../src/schedules/infrastructure/in-memory-schedules.repository.js';
import { STUDENTS_REPOSITORY } from '../../src/students/domain/students.repository.js';
import { InMemoryStudentsRepository } from '../../src/students/infrastructure/in-memory-students.repository.js';
import { SLOTS_REPOSITORY } from '../../src/sync/domain/slots.repository.js';
import { InMemorySlotsRepository } from '../../src/sync/infrastructure/in-memory-slots.repository.js';
import { SyncService } from '../../src/sync/sync.service.js';

export const DEVICE_ID = 'esp32-sim-01';
export const BOGOTA_DATE = '2026-11-02';

/** Bogota wall-clock instant of the fixed test day (UTC-5). */
export const bogotaAt = (time: string, date = BOGOTA_DATE): Date =>
  new Date(`${date}T${time.length === 5 ? `${time}:00` : time}-05:00`);

/** Movable time source: the tests walk through the day without waiting. */
export class MutableClock implements Clock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface InMemoryRepositories {
  devices: InMemoryDevicesRepository;
  processed: InMemoryProcessedMessagesRepository;
  commands: InMemoryDeviceCommandsRepository;
  students: InMemoryStudentsRepository;
  fingerprints: InMemoryFingerprintsRepository;
  enrollments: InMemoryEnrollmentsRepository;
  schedules: InMemorySchedulesRepository;
  instances: InMemoryInstancesRepository;
  slots: InMemorySlotsRepository;
  attendance: InMemoryAttendanceRepository;
  alarm: InMemoryAlarmRepository;
}

export interface InMemoryAppOptions {
  now?: Date;
  alarm?: Partial<AlarmConfig>;
  devices?: Partial<DevicesConfig>;
  /** Short by default so the expiry sweep of the enrollment does not lag. */
  enrollTimeoutSec?: number;
  /**
   * Reuses the repositories of another app: that is how a restart is
   * simulated without leaving the process.
   */
  repositories?: InMemoryRepositories;
}

export interface InMemoryApp {
  app: INestApplication;
  clock: MutableClock;
  repositories: InMemoryRepositories;
  httpUrl: string;
  wsUrl: string;
  /** `x-api-key` header of the admin API. */
  auth: Record<string, string>;
  /** Fresh supertest request against the in-memory app. */
  http: () => request.Agent;
  close: () => Promise<void>;
}

function createRepositories(): InMemoryRepositories {
  const fingerprints = new InMemoryFingerprintsRepository();
  return {
    devices: new InMemoryDevicesRepository(),
    processed: new InMemoryProcessedMessagesRepository(),
    commands: new InMemoryDeviceCommandsRepository(),
    students: new InMemoryStudentsRepository(),
    fingerprints,
    enrollments: new InMemoryEnrollmentsRepository(fingerprints),
    schedules: new InMemorySchedulesRepository(),
    instances: new InMemoryInstancesRepository(),
    slots: new InMemorySlotsRepository(),
    attendance: new InMemoryAttendanceRepository(),
    alarm: new InMemoryAlarmRepository(),
  };
}

/**
 * `AppModule` on in-memory repositories, a movable clock and a short alarm
 * tick, with no PostgreSQL and no hardware. Shared by the command queue tests
 * and the A1–A12 scenarios.
 */
export async function buildInMemoryApp(
  options: InMemoryAppOptions = {},
): Promise<InMemoryApp> {
  const clock = new MutableClock(options.now ?? bogotaAt('09:00'));
  const repositories = options.repositories ?? createRepositories();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(DEVICES_REPOSITORY)
    .useValue(repositories.devices)
    .overrideProvider(PROCESSED_MESSAGES_REPOSITORY)
    .useValue(repositories.processed)
    .overrideProvider(DEVICE_COMMANDS_REPOSITORY)
    .useValue(repositories.commands)
    .overrideProvider(STUDENTS_REPOSITORY)
    .useValue(repositories.students)
    .overrideProvider(FINGERPRINTS_REPOSITORY)
    .useValue(repositories.fingerprints)
    .overrideProvider(ENROLLMENTS_REPOSITORY)
    .useValue(repositories.enrollments)
    .overrideProvider(SCHEDULES_REPOSITORY)
    .useValue(repositories.schedules)
    .overrideProvider(INSTANCES_REPOSITORY)
    .useValue(repositories.instances)
    .overrideProvider(SLOTS_REPOSITORY)
    .useValue(repositories.slots)
    .overrideProvider(ATTENDANCE_REPOSITORY)
    .useValue(repositories.attendance)
    .overrideProvider(ALARM_REPOSITORY)
    .useValue(repositories.alarm)
    .overrideProvider(ALARM_CONFIG)
    .useValue({ ...defaultAlarmConfig, tickMs: 10, ...options.alarm })
    .overrideProvider(DEVICES_CONFIG)
    .useValue({ ...defaultDevicesConfig, ...options.devices })
    .overrideProvider(FINGERPRINTS_CONFIG)
    .useValue({
      ...defaultFingerprintsConfig,
      enrollTimeoutSec: options.enrollTimeoutSec ?? 5,
      ackMarginSec: 0,
      expirySweepMs: 50,
    })
    .compile();

  // The first pass of the alarm scheduler recovers the state; waiting for it
  // keeps a test that moves the clock from racing with that recovery.
  const alarm = moduleRef.get(AlarmService);
  const recover = alarm.recover.bind(alarm);
  let markRecovered: () => void = () => undefined;
  const firstPass = new Promise<void>((resolve) => {
    markRecovered = resolve;
  });
  const recoverSpy = vi
    .spyOn(alarm, 'recover')
    .mockImplementation(async (now) => {
      await recover(now);
      markRecovered();
    });

  const app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  await Promise.race([firstPass, delay(1000)]);
  recoverSpy.mockRestore();

  const { port } = app.getHttpServer().address() as AddressInfo;
  const httpUrl = `http://127.0.0.1:${port}`;

  return {
    app,
    clock,
    repositories,
    httpUrl,
    wsUrl: `ws://127.0.0.1:${port}/device`,
    auth: { 'x-api-key': process.env.ADMIN_API_KEY as string },
    http: () => request(httpUrl) as unknown as request.Agent,
    close: () => app.close(),
  };
}

export interface ScenarioApp extends InMemoryApp {
  deviceId: string;
  /** Starts the simulator and waits until the gateway accepts it. */
  startDevice: () => Promise<DeviceClient>;
  /** Closes the simulator without automatic reconnection. */
  stopDevice: () => Promise<void>;
  device: () => DeviceClient;
  setNow: (time: string | Date) => void;
  advance: (ms: number) => void;
  /** Server frames received by the simulator, in order. */
  framesOf: <T extends ServerMessage['type']>(
    type: T,
  ) => Array<Extract<ServerMessage, { type: T }>>;
  /** Waits for a server frame of `type` (polling briefly). */
  waitForFrame: <T extends ServerMessage['type']>(
    type: T,
    match?: (message: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs?: number,
  ) => Promise<Extract<ServerMessage, { type: T }>>;
  createStudent: (document: string, name?: string) => Promise<string>;
  enroll: (studentId: string) => Promise<void>;
  createEnrolledStudent: (document: string, name?: string) => Promise<string>;
  createSchedule: (input: {
    name: string;
    start: string;
    end: string;
    date?: string;
  }) => Promise<string>;
  assign: (scheduleId: string, studentId: string) => Promise<void>;
  unassign: (scheduleId: string, studentId: string) => Promise<void>;
  sync: () => Promise<Record<string, unknown>>;
  sessions: (
    filter?: Record<string, string>,
  ) => Promise<Record<string, unknown>[]>;
  openSessions: () => Promise<Record<string, unknown>[]>;
  alarmStatus: () => Promise<Record<string, unknown>>;
  /** Slot the reader holds for a student after a sync. */
  resolveSlot: (studentId: string) => Promise<number>;
  /** Client→server frames of the simulator (e.g. `enroll.done`). */
  sentFrames: () => ReadonlyArray<Record<string, unknown>>;
  /** Operator output lines of the simulator. */
  output: () => readonly string[];
}

/**
 * Harness of the A1–A12 scenarios: in-memory app, fixed Bogota day, mutable
 * clock and the real simulator connected to the real gateway.
 */
export async function startScenarioApp(
  options: InMemoryAppOptions = {},
): Promise<ScenarioApp> {
  const base = await buildInMemoryApp(options);
  const { app } = base;
  const received: ServerMessage[] = [];
  const sent: Record<string, unknown>[] = [];
  const lines: string[] = [];
  const logger = {
    frame: (direction: 'in' | 'out', raw: string) => {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (direction === 'in')
        received.push(message as unknown as ServerMessage);
      else sent.push(message);
      lines.push(`${direction} ${String(message.type)}`);
    },
    state: (text: string) => lines.push(`::: ${text}`),
    warn: (text: string) => lines.push(`WARN ${text}`),
  };
  let client: DeviceClient | undefined;

  const device = (): DeviceClient => {
    if (!client) throw new Error('the simulator is not running');
    return client;
  };

  const startDevice = async (): Promise<DeviceClient> => {
    client = new DeviceClient(
      {
        url: base.wsUrl,
        deviceId: DEVICE_ID,
        token: process.env.DEVICE_TOKEN as string,
        fw: 'sim-e2e',
        enroll: {
          mode: 'ok',
          stepMs: 5,
          failReason: 'sim_fail',
          templateBytes: 512,
        },
      },
      logger,
    );
    client.start();
    await vi.waitFor(() => expect(client?.state).toBe('online'));
    return client;
  };

  const stopDevice = async (): Promise<void> => {
    await client?.stop();
    client = undefined;
  };

  const framesOf = <T extends ServerMessage['type']>(
    type: T,
  ): Array<Extract<ServerMessage, { type: T }>> =>
    received.filter(
      (message): message is Extract<ServerMessage, { type: T }> =>
        message.type === type,
    );

  const waitForFrame = async <T extends ServerMessage['type']>(
    type: T,
    match: (message: Extract<ServerMessage, { type: T }>) => boolean = () =>
      true,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMessage, { type: T }>> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = framesOf(type).find(match);
      if (found) return found;
      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for a ${type} frame (${timeoutMs} ms)`,
        );
      }
      await delay(5);
    }
  };

  const createStudent = async (
    document: string,
    name = `Student ${document}`,
  ): Promise<string> => {
    const res = await base
      .http()
      .post('/students')
      .set(base.auth)
      .send({ document, name, consented: true })
      .expect(201);
    return res.body.id as string;
  };

  const enroll = async (studentId: string): Promise<void> => {
    const created = await base
      .http()
      .post(`/students/${studentId}/enrollments`)
      .set(base.auth)
      .send({})
      .expect(201);
    await vi.waitFor(
      async () => {
        const res = await base
          .http()
          .get(`/enrollments/${created.body.id}`)
          .set(base.auth);
        expect(res.body.status).toBe('done');
      },
      { timeout: 5000, interval: 10 },
    );
  };

  const createEnrolledStudent = async (
    document: string,
    name?: string,
  ): Promise<string> => {
    const id = await createStudent(document, name);
    await enroll(id);
    return id;
  };

  const createSchedule = async (input: {
    name: string;
    start: string;
    end: string;
    date?: string;
  }): Promise<string> => {
    const res = await base
      .http()
      .post('/schedules')
      .set(base.auth)
      .send({
        name: input.name,
        date: input.date ?? BOGOTA_DATE,
        start: input.start,
        end: input.end,
      })
      .expect(201);
    return res.body.id as string;
  };

  const assign = async (scheduleId: string, studentId: string) => {
    await base
      .http()
      .put(`/schedules/${scheduleId}/students/${studentId}`)
      .set(base.auth)
      .expect(204);
  };

  const unassign = async (scheduleId: string, studentId: string) => {
    await base
      .http()
      .delete(`/schedules/${scheduleId}/students/${studentId}`)
      .set(base.auth)
      .expect(204);
  };

  const sync = async () => {
    const res = await base.http().post('/sync').set(base.auth).expect(200);
    return res.body as Record<string, unknown>;
  };

  const sessions = async (filter: Record<string, string> = {}) => {
    const res = await base
      .http()
      .get('/attendance/sessions')
      .set(base.auth)
      .query(filter)
      .expect(200);
    return res.body as Record<string, unknown>[];
  };

  const openSessions = async () => {
    const res = await base.http().get('/attendance/open').set(base.auth);
    expect(res.status).toBe(200);
    return res.body as Record<string, unknown>[];
  };

  const alarmStatus = async () => {
    const res = await base.http().get('/alarm/status').set(base.auth);
    expect(res.status).toBe(200);
    return res.body as Record<string, unknown>;
  };

  const resolveSlot = async (studentId: string): Promise<number> => {
    const syncService = app.get(SyncService);
    for (const slot of device().reader.slots) {
      const student = await syncService.findStudentBySlot(DEVICE_ID, slot);
      if (student?.id === studentId) return slot;
    }
    throw new Error(
      `student ${studentId} has no slot in the reader ` +
        `(slots: ${device().reader.slots.join(', ') || 'none'})`,
    );
  };

  return {
    ...base,
    deviceId: DEVICE_ID,
    device,
    startDevice,
    stopDevice,
    setNow: (time) =>
      base.clock.set(typeof time === 'string' ? bogotaAt(time) : time),
    advance: (ms) => base.clock.advance(ms),
    framesOf,
    waitForFrame,
    createStudent,
    enroll,
    createEnrolledStudent,
    createSchedule,
    assign,
    unassign,
    sync,
    sessions,
    openSessions,
    alarmStatus,
    resolveSlot,
    sentFrames: () => sent,
    output: () => lines,
    close: async () => {
      await stopDevice();
      await base.close();
    },
  };
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
