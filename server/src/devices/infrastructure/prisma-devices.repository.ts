import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { DevicesRepository } from '../domain/devices.repository.js';

@Injectable()
export class PrismaDevicesRepository implements DevicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async ensure(id: string) {
    // `createMany` + skipDuplicates is one round trip and never touches an
    // existing row (online state and firmware stay as they are).
    await this.prisma.device.createMany({
      data: [{ id }],
      skipDuplicates: true,
    });
  }

  async upsertOnline(id: string, firmwareVersion: string, at: Date) {
    const data = { online: true, lastConnectedAt: at, firmwareVersion };
    await this.prisma.device.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }

  async setOffline(id: string) {
    await this.prisma.device.updateMany({
      where: { id },
      data: { online: false },
    });
  }

  async setAllOffline() {
    await this.prisma.device.updateMany({ data: { online: false } });
  }

  async findAll() {
    return this.prisma.device.findMany({
      select: {
        id: true,
        online: true,
        lastConnectedAt: true,
        firmwareVersion: true,
      },
      orderBy: { id: 'asc' },
    });
  }
}
