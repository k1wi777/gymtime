import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AttendanceService } from '../attendance/attendance.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { InstancesService } from '../schedules/instances.service.js';
import { AlarmService } from './alarm.service.js';

/**
 * Connects the alarm to the other modules through their extension points:
 * attendance gets the real `AlarmPort` (last session left, button pressed) and
 * a device connection resends the running continuous alarm. Neither module
 * knows `alarm`, so there is no circular dependency.
 */
@Injectable()
export class AlarmRegistrar implements OnModuleInit {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly devices: DevicesService,
    private readonly alarm: AlarmService,
    private readonly instances: InstancesService,
  ) {}

  onModuleInit(): void {
    this.attendance.setAlarmPort(this.alarm);
    // Occurrences with alarm events are history: regenerating schedules keeps them.
    this.instances.addHistoryProbe((ids) =>
      this.alarm.instanceIdsWithAlarms(ids),
    );
    this.devices.onConnected((deviceId) => {
      this.alarm.onDeviceConnected(deviceId);
    });
  }
}
