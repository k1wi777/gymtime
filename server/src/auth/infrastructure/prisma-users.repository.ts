import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  DuplicateUsernameError,
  type NewPanelUser,
  type PanelUser,
  type PanelUserPatch,
} from '../domain/panel-user.js';
import type { UsersRepository } from '../domain/users.repository.js';

@Injectable()
export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  count(): Promise<number> {
    return this.prisma.panelUser.count();
  }

  findById(id: string): Promise<PanelUser | null> {
    return this.prisma.panelUser.findUnique({ where: { id } });
  }

  findByUsername(username: string): Promise<PanelUser | null> {
    return this.prisma.panelUser.findUnique({ where: { username } });
  }

  list(): Promise<PanelUser[]> {
    return this.prisma.panelUser.findMany({ orderBy: { username: 'asc' } });
  }

  async create(data: NewPanelUser): Promise<PanelUser> {
    try {
      return await this.prisma.panelUser.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new DuplicateUsernameError();
      }
      throw error;
    }
  }

  async update(id: string, patch: PanelUserPatch): Promise<PanelUser | null> {
    try {
      return await this.prisma.panelUser.update({ where: { id }, data: patch });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        return null;
      }
      throw error;
    }
  }

  async incrementFailedAttempts(id: string): Promise<number> {
    const row = await this.prisma.panelUser.update({
      where: { id },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });
    return row.failedAttempts;
  }
}
