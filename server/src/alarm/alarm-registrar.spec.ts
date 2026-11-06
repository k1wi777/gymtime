import { AlarmRegistrar } from './alarm-registrar.js';
import type { AlarmService } from './alarm.service.js';
import type { AttendanceService } from '../attendance/attendance.service.js';
import type { InstancesService } from '../schedules/instances.service.js';
import type { DevicesService } from '../devices/devices.service.js';

describe('AlarmRegistrar', () => {
  it('replaces the attendance port and resends on connection', () => {
    const attendance = { setAlarmPort: vi.fn() };
    const devices = { onConnected: vi.fn() };
    const alarm = { onDeviceConnected: vi.fn() };
    const registrar = new AlarmRegistrar(
      attendance as unknown as AttendanceService,
      devices as unknown as DevicesService,
      alarm as unknown as AlarmService,
      { addHistoryProbe: vi.fn() } as unknown as InstancesService,
    );

    registrar.onModuleInit();

    expect(attendance.setAlarmPort).toHaveBeenCalledWith(alarm);
    const listener = devices.onConnected.mock.calls[0]?.[0];
    expect(listener).toBeTypeOf('function');
    listener?.('device-1');
    expect(alarm.onDeviceConnected).toHaveBeenCalledWith('device-1');
  });
});
