import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PROTOCOL_VERSION, type ServerMessage } from '@gymtime/shared';
import { AttendanceService } from '../attendance/attendance.service.js';
import type { AlarmPort } from '../attendance/domain/alarm.port.js';
import { ALARM_LINES } from '../attendance/domain/display.js';
import { EventLogService } from '../common/audit/event-log.service.js';
import { KeyedMutex } from '../common/concurrency/keyed-mutex.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { DevicesService } from '../devices/devices.service.js';
import { DisplayService } from '../devices/display.service.js';
import { OutboundSender } from '../devices/outbound-sender.service.js';
import type { ScheduleInstance } from '../schedules/domain/schedule-instance.js';
import { InstancesService } from '../schedules/instances.service.js';
import { ALARM_CONFIG, type AlarmConfig } from './alarm.config.js';
import {
  ALARM_REPOSITORY,
  type AlarmHistoryFilter,
  type AlarmRepository,
} from './domain/alarm.repository.js';
import { AlarmError } from './domain/alarm.errors.js';
import type {
  AlarmEvent,
  AlarmOffResult,
  AlarmReason,
  AlarmStatus,
} from './domain/alarm-event.js';

const MS_PER_MINUTE = 60_000;
/** Seconds the blank message that clears the screen stays (protocol minimum). */
const CLEAR_SECONDS = 1;

interface CurrentAlarm {
  on: boolean;
  reason: AlarmReason | null;
  instanceId: string | null;
  durationSec: number | null;
  startedAt: Date | null;
  /** Only for the short beep; `null` when the alarm is continuous. */
  expiresAt: Date | null;
}

interface ActiveEvent {
  eventId: string;
  endsAt: Date;
}

const offState = (): CurrentAlarm => ({
  on: false,
  reason: null,
  instanceId: null,
  durationSec: null,
  startedAt: null,
  expiresAt: null,
});

/**
 * Owns the siren state and the `alarm_events` rows. Attendance only reports
 * two facts through `AlarmPort` (an occurrence emptied, the button was
 * pressed); the scheduler reports occurrence ends and timeouts with `tick`.
 *
 * The alarm is global to the single device: with overlapping occurrences it is
 * on while at least one event is open, and `alarm.set` is sent only on the
 * off→on and on→off transitions, never once per occurrence.
 */
@Injectable()
export class AlarmService implements AlarmPort {
  private readonly logger = new Logger(AlarmService.name);
  private readonly mutex = new KeyedMutex();
  private current: CurrentAlarm = offState();
  private readonly activeEvents = new Map<string, ActiveEvent>();
  private lastTick: Date;

  constructor(
    @Inject(ALARM_REPOSITORY) private readonly events: AlarmRepository,
    private readonly attendance: AttendanceService,
    private readonly instances: InstancesService,
    private readonly devices: DevicesService,
    private readonly sender: OutboundSender,
    private readonly systemEvents: SystemEventsService,
    private readonly display: DisplayService,
    private readonly eventLog: EventLogService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ALARM_CONFIG) private readonly config: AlarmConfig,
  ) {
    this.lastTick = this.clock.now();
  }

  /** Occurrences, among these, that have alarm events (history that must be kept). */
  instanceIdsWithAlarms(instanceIds: string[]): Promise<string[]> {
    return this.events.instanceIdsWithEvents(instanceIds);
  }

  /** Alarm history, newest first (E22-3). */
  history(filter: AlarmHistoryFilter) {
    return this.events.list(filter);
  }

  private get timeoutMs(): number {
    return this.config.timeoutMinutes * MS_PER_MINUTE;
  }

  /** End of an occurrence: short beep or continuous alarm (E8-1, E8-2). */
  async onInstanceEnded(
    instance: ScheduleInstance,
    at: Date = this.clock.now(),
  ): Promise<void> {
    await this.mutex.run('alarm', () => this.handleInstanceEnd(instance, at));
  }

  /** Last open session of an occurrence closed: silence and close (E8-3). */
  async onInstanceEmptied(instanceId: string): Promise<void> {
    await this.mutex.run('alarm', async () => {
      const event = await this.events.findOpenByInstance(instanceId);
      if (!event) return;
      await this.events.close(event.id, {
        endedAt: this.clock.now(),
        closedBy: 'all_exited',
        closedSessions: 0,
      });
      this.activeEvents.delete(instanceId);
      this.logger.log({ event: 'alarm_all_exited', instanceId });
      if ((await this.events.findOpen()).length === 0 && this.current.on) {
        this.clearAlarm({ closedBy: 'all_exited', sessionsClosed: 0 });
      }
    });
  }

  /** Physical button: silences a running alarm, otherwise only registers (E8-4, R6). */
  async onButtonPressed(deviceId: string): Promise<void> {
    await this.mutex.run('alarm', async () => {
      if (!this.current.on) {
        this.logger.log({ event: 'button_pressed_no_alarm', deviceId });
        return;
      }
      await this.silence('button');
    });
  }

  /** Manual off from the CLI; fails when there is nothing to silence (R5, R6). */
  off(closedBy: 'button' | 'cli'): Promise<AlarmOffResult> {
    return this.mutex.run('alarm', async () => {
      if (!this.current.on) throw new AlarmError('ALARM_NOT_ON');
      return this.silence(closedBy);
    });
  }

  /** `gym alarm test` / `gym alarm on` (E8-5, R7, R8, R15). */
  async turnOn(reason: 'TEST' | 'MANUAL'): Promise<AlarmStatus> {
    const deviceId = await this.devices.getOnlineDeviceId();
    if (!deviceId) throw new AlarmError('NO_DEVICE_ONLINE');
    return this.mutex.run('alarm', async () => {
      const durationSec = reason === 'TEST' ? this.config.beepSeconds : null;
      const now = this.clock.now();
      this.current = {
        on: true,
        reason,
        instanceId: null,
        durationSec,
        startedAt: now,
        expiresAt:
          durationSec === null
            ? null
            : new Date(now.getTime() + durationSec * 1000),
      };
      this.emitAlarm({ on: true, reason });
      this.sendTo(deviceId, {
        on: true,
        durationSec,
        reason,
      });
      this.logger.log({ event: 'alarm_manual', reason, deviceId });
      await this.eventLog.record('alarm.manual_on', { reason, deviceId });
      return this.status();
    });
  }

  /** Current state plus how many sessions are open right now (R9). */
  async status(): Promise<AlarmStatus> {
    return {
      on: this.current.on,
      reason: this.current.reason,
      instanceId: this.current.instanceId,
      durationSec: this.current.durationSec,
      startedAt: this.current.startedAt,
      openSessions: (await this.attendance.listOpenStudentIds()).length,
    };
  }

  /**
   * Re-sends the continuous alarm to a device that just connected (R12),
   * with its screen message when the alarm is waiting for exits.
   */
  onDeviceConnected(deviceId: string): void {
    if (!this.current.on || this.current.durationSec !== null) return;
    this.sendTo(deviceId, {
      on: true,
      durationSec: null,
      reason: this.current.reason ?? 'PENDING_EXIT',
    });
    if (this.current.reason === 'PENDING_EXIT') {
      this.showAlarmMessage(this.remainingSeconds(), deviceId);
    }
    this.logger.log({
      event: 'alarm_resent',
      deviceId,
      reason: this.current.reason,
    });
  }

  /**
   * Rebuilds the state from the open events after a restart: the recovery
   * window is `(now - timeout, now]`, so overdue events are closed and a
   * pending occurrence is restored without a duplicate `alarm.set` (R11).
   */
  async recover(now: Date = this.clock.now()): Promise<void> {
    await this.mutex.run('alarm', async () => {
      const open = await this.events.findOpen();
      const occurrences = await this.instances.getByIds(
        open.map((event) => event.instanceId),
      );
      this.activeEvents.clear();
      this.current = offState();
      let first: AlarmEvent | undefined;
      for (const event of open) {
        const occurrence = occurrences.get(event.instanceId);
        if (!occurrence) continue;
        this.activeEvents.set(event.instanceId, {
          eventId: event.id,
          endsAt: occurrence.instance.endsAt,
        });
        first ??= event;
      }
      if (first) {
        this.current = {
          on: true,
          reason: 'PENDING_EXIT',
          instanceId: first.instanceId,
          durationSec: null,
          startedAt: first.startedAt,
          expiresAt: null,
        };
        this.logger.log({
          event: 'alarm_recovered',
          events: this.activeEvents.size,
        });
      }
      this.lastTick = new Date(now.getTime() - this.timeoutMs);
    });
  }

  /** One scheduler pass: ends, beep expiry and timeouts (R1, R10, R11). */
  async tick(now: Date = this.clock.now()): Promise<void> {
    await this.mutex.run('alarm', async () => {
      const { ended } = await this.instances.listWithEdgesBetween(
        this.lastTick,
        now,
        0,
      );
      for (const instance of ended) {
        await this.handleInstanceEnd(instance, now);
      }
      this.expireBeep(now);
      await this.closeExpired(now);
      this.lastTick = now;
    });
  }

  private async handleInstanceEnd(
    instance: ScheduleInstance,
    at: Date,
  ): Promise<void> {
    const openEvent = await this.events.findOpenByInstance(instance.id);
    if (openEvent) {
      // Already processed (or recovered): restore the timeout tracking only.
      this.activeEvents.set(instance.id, {
        eventId: openEvent.id,
        endsAt: instance.endsAt,
      });
      return;
    }

    const openSessions = await this.attendance.countOpenByInstance(instance.id);
    const lateMs = at.getTime() - instance.endsAt.getTime();
    if (openSessions === 0) {
      this.beepIfLive(instance, lateMs);
      return;
    }
    if (lateMs > this.timeoutMs) {
      // The server was down for longer than the timeout: close without sound.
      const closed = await this.attendance.markUnregisteredByInstance(
        instance.id,
        'timeout',
      );
      this.logger.log({
        event: 'alarm_recovery_timeout',
        instanceId: instance.id,
        sessionsClosed: closed,
      });
      return;
    }

    const event = await this.events.create({
      instanceId: instance.id,
      startedAt: instance.endsAt,
    });
    this.activeEvents.set(instance.id, {
      eventId: event.id,
      endsAt: instance.endsAt,
    });
    this.logger.log({
      event: 'alarm_pending_exit',
      instanceId: instance.id,
      sessions: openSessions,
    });
    this.startContinuous(instance.id);
  }

  /** A beep is only replayed when its end fell inside the live tick. */
  private beepIfLive(instance: ScheduleInstance, lateMs: number): void {
    if (lateMs > this.config.tickMs || this.current.on) return;
    const now = this.clock.now();
    const beepSeconds = this.config.beepSeconds;
    this.current = {
      on: true,
      reason: 'END_BEEP',
      instanceId: instance.id,
      durationSec: beepSeconds,
      startedAt: now,
      expiresAt: new Date(now.getTime() + beepSeconds * 1000),
    };
    this.emitAlarm({ on: true, reason: 'END_BEEP' });
    this.dispatch({ on: true, durationSec: beepSeconds, reason: 'END_BEEP' });
    this.logger.log({ event: 'alarm_end_beep', instanceId: instance.id });
  }

  /** Only sends when moving to a continuous alarm; overlap reuses the state. */
  private startContinuous(instanceId: string): void {
    if (this.current.on && this.current.durationSec === null) return;
    this.current = {
      on: true,
      reason: 'PENDING_EXIT',
      instanceId,
      durationSec: null,
      startedAt: this.clock.now(),
      expiresAt: null,
    };
    this.emitAlarm({ on: true, reason: 'PENDING_EXIT' });
    this.dispatch({ on: true, durationSec: null, reason: 'PENDING_EXIT' });
    // The protocol has no "until further notice": the message lasts as long as
    // the alarm can, and CLEARED removes it earlier.
    this.showAlarmMessage(this.config.timeoutMinutes * 60);
  }

  /** Seconds until the last open event times out; at least 1. */
  private remainingSeconds(now: Date = this.clock.now()): number {
    const ends = [...this.activeEvents.values()].map(
      (active) => active.endsAt.getTime() + this.timeoutMs,
    );
    if (ends.length === 0) return this.config.timeoutMinutes * 60;
    return Math.max(1, Math.ceil((Math.max(...ends) - now.getTime()) / 1000));
  }

  private expireBeep(now: Date): void {
    if (!this.current.on || this.current.expiresAt === null) return;
    if (this.current.expiresAt > now) return;
    this.current = offState();
    this.logger.log({ event: 'alarm_beep_expired' });
  }

  private async closeExpired(now: Date): Promise<void> {
    let closedLast = false;
    let closedTotal = 0;
    for (const [instanceId, active] of this.activeEvents) {
      if (active.endsAt.getTime() + this.timeoutMs > now.getTime()) continue;
      const sessionsClosed = await this.attendance.markUnregisteredByInstance(
        instanceId,
        'timeout',
      );
      const closed = await this.events.close(active.eventId, {
        endedAt: now,
        closedBy: 'timeout',
        closedSessions: sessionsClosed,
      });
      if (!closed) continue;
      this.activeEvents.delete(instanceId);
      closedLast = true;
      closedTotal += sessionsClosed;
      this.logger.log({
        event: 'alarm_timeout',
        instanceId,
        sessionsClosed,
      });
    }
    if (closedLast && this.activeEvents.size === 0 && this.current.on) {
      this.clearAlarm({ closedBy: 'timeout', sessionsClosed: closedTotal });
    }
  }

  /** Silences every open event; the caller already holds the mutex. */
  private async silence(closedBy: 'button' | 'cli'): Promise<AlarmOffResult> {
    const now = this.clock.now();
    const reason = closedBy === 'button' ? 'alarm_off_button' : 'alarm_off_cli';
    const open = await this.events.findOpen();
    let sessionsClosed = 0;
    for (const event of open) {
      const count = await this.attendance.markUnregisteredByInstance(
        event.instanceId,
        reason,
      );
      await this.events.close(event.id, {
        endedAt: now,
        closedBy,
        closedSessions: count,
      });
      this.activeEvents.delete(event.instanceId);
      sessionsClosed += count;
    }
    this.clearAlarm({ closedBy, sessionsClosed });
    this.logger.log({
      event: 'alarm_off',
      closedBy,
      events: open.length,
      sessionsClosed,
    });
    await this.eventLog.record(
      closedBy === 'button' ? 'alarm.button_off' : 'alarm.manual_off',
      { events: open.length, sessionsClosed },
    );
    return { closedBy, sessionsClosed, status: await this.status() };
  }

  /**
   * Clears the state and publishes the alarm event. `details` is only present
   * when the siren is silenced (they describe why and what was closed).
   */
  private clearAlarm(details?: {
    closedBy: 'all_exited' | 'button' | 'cli' | 'timeout';
    sessionsClosed: number;
  }): void {
    const hadMessage = this.current.reason === 'PENDING_EXIT';
    this.current = offState();
    this.systemEvents.emit('alarm', {
      on: false,
      reason: 'CLEARED',
      closedBy: details?.closedBy ?? null,
      sessionsClosed: details?.sessionsClosed ?? 0,
    });
    this.dispatch({ on: false, durationSec: null, reason: 'CLEARED' });
    if (hadMessage) this.clearAlarmMessage();
  }

  /**
   * Blank lines replace the alarm text, and `supersedesPrevious` fails the
   * alarm message that was never confirmed so it is not replayed afterwards.
   */
  private clearAlarmMessage(): void {
    this.sendMessage('', '', CLEAR_SECONDS);
  }

  private showAlarmMessage(durationSec: number, deviceId?: string): void {
    this.sendMessage(
      ALARM_LINES.line1,
      ALARM_LINES.line2,
      durationSec,
      deviceId,
    );
  }

  /** Fire and forget, like `dispatch`; the server composes it, so it is not audited. */
  private sendMessage(
    line1: string,
    line2: string,
    durationSec: number,
    deviceId?: string,
  ): void {
    void (async () => {
      try {
        await this.display.show(
          {
            deviceId: deviceId ?? (await this.display.defaultDevice()),
            line1,
            line2,
            durationSec,
          },
          { supersedesPrevious: true, audit: false },
        );
      } catch (error) {
        this.logger.error({
          event: 'alarm_message_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }

  private emitAlarm(payload: { on: boolean; reason: AlarmReason }): void {
    this.systemEvents.emit('alarm', {
      on: payload.on,
      reason: payload.reason,
      closedBy: null,
      sessionsClosed: 0,
    });
  }

  /** Sends to the only known device without blocking the caller. */
  private dispatch(payload: {
    on: boolean;
    durationSec: number | null;
    reason: AlarmReason;
  }): void {
    void (async () => {
      try {
        const deviceId =
          (await this.devices.getOnlineDeviceId()) ??
          (await this.devices.getOnlyDeviceId());
        if (!deviceId) {
          this.logger.warn({
            event: 'alarm_no_device',
            reason: payload.reason,
          });
          return;
        }
        this.sendTo(deviceId, payload);
      } catch (error) {
        this.logger.error({
          event: 'alarm_send_failed',
          reason: payload.reason,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }

  /**
   * Fire and forget: the device ack must leave in under 5 s and the sender may
   * wait up to 20 s. A failed send keeps the state and the event.
   */
  private sendTo(
    deviceId: string,
    payload: {
      on: boolean;
      durationSec: number | null;
      reason: AlarmReason;
    },
  ): void {
    const message = {
      v: PROTOCOL_VERSION,
      id: randomUUID(),
      type: 'alarm.set',
      ts: Math.floor(this.clock.now().getTime() / 1000),
      ref: null,
      payload,
    } as ServerMessage;
    void this.sender
      .sendCommand(deviceId, message, { supersedesPrevious: true })
      .then((result) => {
        if (result === 'failed') {
          this.logger.warn({
            event: 'alarm_send_failed',
            deviceId,
            reason: payload.reason,
          });
        }
      })
      .catch((error: unknown) => {
        this.logger.error({
          event: 'alarm_send_failed',
          deviceId,
          reason: payload.reason,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}
