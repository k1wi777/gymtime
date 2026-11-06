import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type {
  AuthSession,
  NewAuthSession,
  SessionWithUser,
  SessionsRepository,
} from '../domain/sessions.repository.js';

const toSession = (row: AuthSession & { tokenHash?: string }): AuthSession => ({
  id: row.id,
  userId: row.userId,
  createdAt: row.createdAt,
  lastActivityAt: row.lastActivityAt,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
});

@Injectable()
export class PrismaSessionsRepository implements SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewAuthSession): Promise<AuthSession> {
    const row = await this.prisma.authSession.create({
      data: {
        userId: data.userId,
        tokenHash: data.tokenHash,
        createdAt: data.now,
        lastActivityAt: data.now,
        expiresAt: data.expiresAt,
      },
    });
    return toSession(row);
  }

  async findByTokenHash(tokenHash: string): Promise<SessionWithUser | null> {
    const row = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    return row ? { session: toSession(row), user: row.user } : null;
  }

  async findById(id: string): Promise<SessionWithUser | null> {
    const row = await this.prisma.authSession.findUnique({
      where: { id },
      include: { user: true },
    });
    return row ? { session: toSession(row), user: row.user } : null;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id },
      data: { lastActivityAt: at },
    });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllForUser(
    userId: string,
    at: Date,
    exceptSessionId?: string,
  ): Promise<number> {
    const { count } = await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: at },
    });
    return count;
  }

  async deleteDead(now: Date, idleBefore: Date): Promise<number> {
    const { count } = await this.prisma.authSession.deleteMany({
      where: {
        OR: [
          { revokedAt: { not: null } },
          { expiresAt: { lte: now } },
          { lastActivityAt: { lte: idleBefore } },
        ],
      },
    });
    return count;
  }
}
