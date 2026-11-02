import type {
  DeviceCommand,
  NewDeviceCommand,
} from '../domain/device-command.js';
import type { DeviceCommandsRepository } from '../domain/device-commands.repository.js';

export class InMemoryDeviceCommandsRepository implements DeviceCommandsRepository {
  private readonly commands = new Map<string, DeviceCommand>();

  create(command: NewDeviceCommand): Promise<void> {
    this.commands.set(command.id, {
      ...command,
      status: 'pending',
      attempts: 0,
    });
    return Promise.resolve();
  }

  findById(id: string): Promise<DeviceCommand | null> {
    return Promise.resolve(this.commands.get(id) ?? null);
  }

  markSent(id: string, attempts: number): Promise<void> {
    return this.update(id, ['pending', 'sent'], { status: 'sent', attempts });
  }

  markAcked(id: string): Promise<void> {
    return this.update(id, ['pending', 'sent'], { status: 'acked' });
  }

  markFailed(id: string): Promise<void> {
    return this.update(id, ['pending', 'sent'], { status: 'failed' });
  }

  markPending(id: string): Promise<void> {
    return this.update(id, ['sent'], { status: 'pending' });
  }

  countUnconfirmed(deviceId: string): Promise<number> {
    return Promise.resolve(
      [...this.commands.values()].filter(
        (command) =>
          command.deviceId === deviceId &&
          (command.status === 'pending' || command.status === 'sent'),
      ).length,
    );
  }

  findPendingForDevice(deviceId: string): Promise<DeviceCommand[]> {
    return Promise.resolve(this.sorted(deviceId, () => true, 'pending'));
  }

  findUnconfirmedForDevice(
    deviceId: string,
    type: string,
  ): Promise<DeviceCommand[]> {
    return Promise.resolve(
      this.sorted(
        deviceId,
        (command) =>
          command.type === type &&
          (command.status === 'pending' || command.status === 'sent'),
      ),
    );
  }

  resetSentToPending(): Promise<number> {
    let count = 0;
    for (const [id, command] of this.commands) {
      if (command.status !== 'sent') continue;
      this.commands.set(id, { ...command, status: 'pending' });
      count += 1;
    }
    return Promise.resolve(count);
  }

  private sorted(
    deviceId: string,
    predicate: (command: DeviceCommand) => boolean,
    status?: DeviceCommand['status'],
  ): DeviceCommand[] {
    return [...this.commands.values()]
      .filter(
        (command) =>
          command.deviceId === deviceId &&
          (status === undefined || command.status === status) &&
          predicate(command),
      )
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
  }

  private update(
    id: string,
    from: DeviceCommand['status'][],
    patch: Partial<DeviceCommand>,
  ): Promise<void> {
    const command = this.commands.get(id);
    if (command && from.includes(command.status)) {
      this.commands.set(id, { ...command, ...patch });
    }
    return Promise.resolve();
  }
}
