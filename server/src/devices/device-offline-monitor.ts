import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EventLogService } from '../common/audit/event-log.service.js';
import {
  ALWAYS_LEADER,
  LEADER_LOCK,
  type LeaderLock,
} from '../common/concurrency/leader-lock.js';
import { SystemEventsService } from '../common/events/system-events.service.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import { DevicesService } from './devices.service.js';

export const OFFLINE_CHECK_MS = 30_000;

/**
 * Raises one alert per drop when a device that had connected stays offline
 * longer than DEVICE_OFFLINE_ALERT_MINUTES (0 disables it), and records the
 * recovery. Runs only on the instance holding the scheduler lock. The alert
 * goes to the log, the audit trail and the event stream; the panel shows it
 * until the device reconnects. `/health` monitoring covers "server down",
 * this covers "device down".
 */
@Injectable()
export class DeviceOfflineMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceOfflineMonitor.name);
  private timer: NodeJS.Timeout | undefined;
  private checking = false;

  constructor(
    private readonly devices: DevicesService,
    private readonly eventLog: EventLogService,
    private readonly events: SystemEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LEADER_LOCK) private readonly lock: LeaderLock = ALWAYS_LEADER,
  ) {}

  onModuleInit(): void {
    this.devices.onRecovered((deviceId) => this.recovered(deviceId));
    this.timer = setInterval(() => void this.check(), OFFLINE_CHECK_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass; never throws. Returns how many alerts it raised. */
  async check(): Promise<number> {
    if (!this.lock.isLeader() || this.checking) return 0;
    this.checking = true;
    let raised = 0;
    try {
      const now = this.clock.now();
      for (const device of await this.devices.findOverdueOffline(now)) {
        // The claim is conditional: if another pass or instance got there
        // first, this one stays silent (one alert per drop).
        if (!(await this.devices.claimOfflineAlert(device.id, now))) continue;
        const offlineMinutes = Math.floor(
          (now.getTime() - (device.offlineSince as Date).getTime()) / 60_000,
        );
        const thresholdMinutes = this.devices.offlineAlertMinutes;
        this.logger.warn({
          event: 'device_offline_alert',
          deviceId: device.id,
          offlineMinutes,
          thresholdMinutes,
        });
        await this.eventLog.record('device.offline_alert', {
          deviceId: device.id,
          offlineMinutes,
          thresholdMinutes,
        });
        this.events.emit(
          'device.offline_alert',
          { deviceId: device.id, offlineMinutes, thresholdMinutes },
          now,
        );
        raised++;
      }
    } catch (error) {
      this.logger.error({
        event: 'offline_check_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.checking = false;
    }
    return raised;
  }

  private async recovered(deviceId: string): Promise<void> {
    this.logger.log({ event: 'device_recovered', deviceId });
    await this.eventLog.record('device.recovered', { deviceId });
  }
}
