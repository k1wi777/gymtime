import type { DeviceStatus, EventOf, SystemEvent } from '@/api/types';
import {
  MAX_COMMANDS,
  MAX_SCANS,
  applyCommand,
  applyDeviceEvent,
  pushScan,
} from '@/live/reducers';

const scan = (i: number): EventOf<'scan'> => ({
  type: 'scan',
  at: `2026-11-02T15:00:${String(i % 60).padStart(2, '0')}.000Z`,
  data: {
    deviceId: 'd',
    slot: i,
    result: 'entry',
    studentId: null,
    studentName: `S${i}`,
    reason: null,
  },
});

const command = (
  id: string,
  status: EventOf<'command'>['data']['status'],
  at = '2026-11-02T15:00:00.000Z',
): EventOf<'command'> => ({
  type: 'command',
  at,
  data: {
    deviceId: 'd',
    commandId: id,
    commandType: 'alarm.set',
    status,
    attempts: 1,
  },
});

describe('live reducers', () => {
  it('keeps the 20 newest scans, newest first', () => {
    let feed = pushScan([], scan(0));
    for (let i = 1; i < 30; i++) feed = pushScan(feed, scan(i));
    expect(feed).toHaveLength(MAX_SCANS);
    expect(feed[0]?.data.studentName).toBe('S29');
    expect(new Set(feed.map((s) => s.key)).size).toBe(MAX_SCANS);
  });

  it('updates a command in place as its status advances', () => {
    let list = applyCommand(
      [],
      command('a', 'pending', '2026-11-02T15:00:00.000Z'),
    );
    list = applyCommand(list, command('b', 'pending'));
    list = applyCommand(list, command('a', 'sent', '2026-11-02T15:00:05.000Z'));
    list = applyCommand(
      list,
      command('a', 'acked', '2026-11-02T15:00:06.000Z'),
    );
    expect(list.map((c) => [c.commandId, c.status])).toEqual([
      ['b', 'pending'],
      ['a', 'acked'],
    ]);
    // The order of the table does not jump around, and the first time stays.
    expect(list[1]?.at).toBe('2026-11-02T15:00:00.000Z');
  });

  it('bounds the command list', () => {
    let list: ReturnType<typeof applyCommand> = [];
    for (let i = 0; i < 25; i++)
      list = applyCommand(list, command(`c${i}`, 'pending'));
    expect(list).toHaveLength(MAX_COMMANDS);
    expect(list[0]?.commandId).toBe('c24');
  });

  it('applies connection events to the devices', () => {
    const devices: DeviceStatus[] = [
      {
        deviceId: 'd',
        online: false,
        lastConnectedAt: null,
        firmwareVersion: null,
        pendingCommands: 2,
      },
    ];
    const connected: SystemEvent = {
      type: 'device.connected',
      at: '2026-11-02T15:00:00.000Z',
      data: { deviceId: 'd', firmwareVersion: '1.2.3' },
    };
    const up = applyDeviceEvent(devices, connected);
    expect(up[0]).toMatchObject({
      online: true,
      firmwareVersion: '1.2.3',
      pendingCommands: 2,
      lastConnectedAt: connected.at,
    });

    const down = applyDeviceEvent(up, {
      type: 'device.disconnected',
      at: '2026-11-02T15:05:00.000Z',
      data: { deviceId: 'd', reason: 'heartbeat_timeout' },
    });
    expect(down[0]?.online).toBe(false);

    expect(applyDeviceEvent([], connected)).toHaveLength(1);
  });
});
