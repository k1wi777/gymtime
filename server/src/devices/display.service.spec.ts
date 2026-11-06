import { EventLogService } from '../common/audit/event-log.service.js';
import { runAsActor } from '../common/audit/actor.js';
import { InMemoryEventLogRepository } from '../common/audit/in-memory-event-log.repository.js';
import { DisplayValidationError } from '../common/display/display.errors.js';
import { DevicesService } from './devices.service.js';
import { DisplayService } from './display.service.js';
import { NoDeviceError } from './domain/no-device.error.js';
import { InMemoryDeviceCommandsRepository } from './infrastructure/in-memory-device-commands.repository.js';
import { InMemoryDevicesRepository } from './infrastructure/in-memory-devices.repository.js';
import type { OutboundSender } from './outbound-sender.service.js';

function build(result: 'acked' | 'queued' | 'failed' = 'acked') {
  const devices = new DevicesService(
    new InMemoryDevicesRepository(),
    new InMemoryDeviceCommandsRepository(),
  );
  const sendCommand = vi.fn().mockResolvedValue(result);
  const eventLog = new InMemoryEventLogRepository();
  const service = new DisplayService(
    devices,
    { sendCommand } as unknown as OutboundSender,
    new EventLogService(eventLog),
    { cols: 16, rows: 2, resultSeconds: 3 },
  );
  return { devices, service, sendCommand, eventLog };
}

describe('DisplayService', () => {
  it('sends a normalized display.message with the default duration', async () => {
    const { devices, service, sendCommand } = build();
    await devices.markOnline('d1', 'fw');
    const outcome = await service.show({ line1: 'Mañana', line2: 'Árbol' });
    expect(outcome).toEqual({
      commandId: expect.any(String),
      deviceId: 'd1',
      status: 'acked',
    });
    expect(sendCommand).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        v: 1,
        id: outcome.commandId,
        type: 'display.message',
        ref: null,
        payload: { line1: 'Manana', line2: 'Arbol', durationSec: 3 },
      }),
      { supersedesPrevious: undefined },
    );
  });

  it('queues for the only known device when it is offline (R2)', async () => {
    const { devices, service } = build('queued');
    await devices.ensureDevice('d1');
    expect(await service.show({ line1: 'Hola' })).toMatchObject({
      deviceId: 'd1',
      status: 'queued',
    });
  });

  it('prefers the explicit device', async () => {
    const { service, sendCommand } = build();
    await service.show({ deviceId: 'esp-9', line1: 'Hola' });
    expect(sendCommand.mock.calls[0]?.[0]).toBe('esp-9');
  });

  it('rejects more than two lines worth of text and creates no order', async () => {
    const { devices, service, sendCommand } = build();
    await devices.markOnline('d1', 'fw');
    await expect(
      service.show({ line1: 'x'.repeat(17) }),
    ).rejects.toBeInstanceOf(DisplayValidationError);
    await expect(service.show({ line1: 'ok 😀' })).rejects.toBeInstanceOf(
      DisplayValidationError,
    );
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('fails with NoDeviceError when there is nobody to address', async () => {
    const { service } = build();
    await expect(service.show({ line1: 'Hola' })).rejects.toBeInstanceOf(
      NoDeviceError,
    );
  });

  it('forwards supersedesPrevious and accepts empty lines (screen clear)', async () => {
    const { devices, service, sendCommand } = build();
    await devices.markOnline('d1', 'fw');
    await service.show(
      { line1: '', line2: '', durationSec: 1 },
      { supersedesPrevious: true, audit: false },
    );
    expect(sendCommand.mock.calls[0]?.[2]).toEqual({
      supersedesPrevious: true,
    });
    expect(sendCommand.mock.calls[0]?.[1].payload).toEqual({
      line1: '',
      line2: '',
      durationSec: 1,
    });
  });

  it('audits the manual message with the current actor (R19)', async () => {
    const { devices, service, eventLog } = build();
    await devices.markOnline('d1', 'fw');
    await runAsActor({ type: 'user', id: 'u1' }, () =>
      service.show({ line1: 'Hola' }),
    );
    await service.show({ line1: 'Sistema' }, { audit: false });
    expect(eventLog.entries).toHaveLength(1);
    expect(eventLog.entries[0]).toMatchObject({
      type: 'display.message_sent',
      actor: { type: 'user', id: 'u1' },
      detail: { deviceId: 'd1', line1: 'Hola', status: 'acked' },
    });
  });
});
