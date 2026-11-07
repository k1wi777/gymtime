import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  DevicesRepository,
  TokenState,
} from '../domain/devices.repository.js';

const DEVICE_FIELDS = {
  id: true,
  online: true,
  lastConnectedAt: true,
  firmwareVersion: true,
  tokenHash: true,
  tokenCreatedAt: true,
  tokenRevokedAt: true,
  offlineSince: true,
  offlineAlertedAt: true,
  capabilities: true,
  clockOffsetSec: true,
  clockCheckedAt: true,
} as const;

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

  async upsertOnline(
    id: string,
    firmwareVersion: string,
    at: Date,
    capabilities: string[] = [],
  ) {
    const before = await this.prisma.device.findUnique({
      where: { id },
      select: { offlineAlertedAt: true },
    });
    const data = {
      online: true,
      lastConnectedAt: at,
      firmwareVersion,
      offlineSince: null,
      offlineAlertedAt: null,
      capabilities,
    };
    await this.prisma.device.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
    return { recovered: before?.offlineAlertedAt != null };
  }

  async setClock(id: string, offsetSec: number, at: Date) {
    await this.prisma.device.updateMany({
      where: { id },
      data: { clockOffsetSec: offsetSec, clockCheckedAt: at },
    });
  }

  async setOffline(id: string, at: Date) {
    // The first drop marks the start; a repeated close keeps it.
    await this.prisma.device.updateMany({
      where: { id, offlineSince: null },
      data: { offlineSince: at },
    });
    await this.prisma.device.updateMany({
      where: { id },
      data: { online: false },
    });
  }

  async setAllOffline(at: Date) {
    await this.prisma.device.updateMany({
      where: { offlineSince: null },
      data: { offlineSince: at },
    });
    await this.prisma.device.updateMany({ data: { online: false } });
  }

  async markAlerted(id: string, at: Date) {
    const { count } = await this.prisma.device.updateMany({
      where: { id, online: false, offlineAlertedAt: null },
      data: { offlineAlertedAt: at },
    });
    return count > 0;
  }

  async findAll() {
    return this.prisma.device.findMany({
      select: DEVICE_FIELDS,
      orderBy: { id: 'asc' },
    });
  }

  findById(id: string) {
    return this.prisma.device.findUnique({
      where: { id },
      select: DEVICE_FIELDS,
    });
  }

  async setToken(id: string, state: TokenState) {
    const { count } = await this.prisma.device.updateMany({
      where: { id },
      data: state,
    });
    return count > 0;
  }
}
