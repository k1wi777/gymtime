import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  DeviceCommand,
  NewDeviceCommand,
} from '../domain/device-command.js';
import type { DeviceCommandsRepository } from '../domain/device-commands.repository.js';

const COLUMNS = {
  id: true,
  deviceId: true,
  type: true,
  payload: true,
  status: true,
  attempts: true,
  createdAt: true,
} as const;

@Injectable()
export class PrismaDeviceCommandsRepository implements DeviceCommandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(command: NewDeviceCommand): Promise<void> {
    await this.prisma.deviceCommand.create({
      data: {
        id: command.id,
        deviceId: command.deviceId,
        type: command.type,
        payload: command.payload as Prisma.InputJsonValue,
        status: 'pending',
        attempts: 0,
        createdAt: command.createdAt,
      },
    });
  }

  findById(id: string): Promise<DeviceCommand | null> {
    return this.prisma.deviceCommand.findUnique({
      where: { id },
      select: COLUMNS,
    });
  }

  async markSent(id: string, attempts: number): Promise<void> {
    await this.prisma.deviceCommand.updateMany({
      where: { id, status: { in: ['pending', 'sent'] } },
      data: { status: 'sent', attempts },
    });
  }

  async markAcked(id: string): Promise<void> {
    await this.prisma.deviceCommand.updateMany({
      where: { id, status: { in: ['pending', 'sent'] } },
      data: { status: 'acked' },
    });
  }

  async markFailed(id: string): Promise<void> {
    await this.prisma.deviceCommand.updateMany({
      where: { id, status: { in: ['pending', 'sent'] } },
      data: { status: 'failed' },
    });
  }

  async markPending(id: string): Promise<void> {
    await this.prisma.deviceCommand.updateMany({
      where: { id, status: 'sent' },
      data: { status: 'pending' },
    });
  }

  countUnconfirmed(deviceId: string): Promise<number> {
    return this.prisma.deviceCommand.count({
      where: { deviceId, status: { in: ['pending', 'sent'] } },
    });
  }

  findPendingForDevice(deviceId: string): Promise<DeviceCommand[]> {
    return this.prisma.deviceCommand.findMany({
      where: { deviceId, status: 'pending' },
      select: COLUMNS,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  findUnconfirmedForDevice(
    deviceId: string,
    type: string,
  ): Promise<DeviceCommand[]> {
    return this.prisma.deviceCommand.findMany({
      where: { deviceId, type, status: { in: ['pending', 'sent'] } },
      select: COLUMNS,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async resetSentToPending(): Promise<number> {
    const { count } = await this.prisma.deviceCommand.updateMany({
      where: { status: 'sent' },
      data: { status: 'pending' },
    });
    return count;
  }
}
