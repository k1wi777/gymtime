import { Injectable, type OnModuleInit } from '@nestjs/common';
import { AttendanceService } from '../attendance/attendance.service.js';
import { DevicesService } from '../devices/devices.service.js';
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
  ) {}

  onModuleInit(): void {
    this.attendance.setAlarmPort(this.alarm);
    this.devices.onConnected((deviceId) => {
      this.alarm.onDeviceConnected(deviceId);
    });
  }
}
