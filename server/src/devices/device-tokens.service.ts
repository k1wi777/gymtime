import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventLogService } from '../common/audit/event-log.service.js';
import { safeEqual } from '../common/auth/safe-equal.js';
import { CLOCK, type Clock } from '../common/time/clock.js';
import type { Env } from '../config/env.schema.js';
import {
  CLOSE_TOKEN_CHANGED,
  ConnectionRegistry,
} from './connection-registry.js';
import { tokenStatusOf, type TokenStatus } from './domain/device.js';
import {
  DEVICES_REPOSITORY,
  type DevicesRepository,
} from './domain/devices.repository.js';

export const TOKEN_PREFIX = 'gt_dev_';

/** Which credential accepted the hello; `false` = refused. */
export type TokenVerdict = 'own' | 'legacy' | false;

/** The device already has an own token: rotate it instead (409). */
export class DeviceAlreadyRegisteredError extends Error {
  constructor(readonly deviceId: string) {
    super(`El dispositivo ${deviceId} ya tiene token propio; use rotate`);
  }
}

/** The device does not exist (404). */
export class UnknownDeviceError extends Error {
  constructor(readonly deviceId: string) {
    super(`Dispositivo desconocido: ${deviceId}`);
  }
}

export interface IssuedToken {
  deviceId: string;
  /** Shown once: only its hash is stored. */
  token: string;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/**
 * Own credential per device (H11). One active token per device: rotating
 * overwrites the hash and revoking clears it, so the old token dies at once
 * and the open connection is closed. 256 bits of entropy make a fast hash
 * enough (argon2id protects low-entropy secrets).
 */
@Injectable()
export class DeviceTokensService {
  private readonly logger = new Logger(DeviceTokensService.name);

  constructor(
    @Inject(DEVICES_REPOSITORY) private readonly repository: DevicesRepository,
    private readonly registry: ConnectionRegistry,
    private readonly eventLog: EventLogService,
    private readonly config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Own token if the device has one; else, only while it was never revoked
   * and DEVICE_TOKEN is defined, the shared token (transition, warned).
   */
  async verify(deviceId: string, token: string): Promise<TokenVerdict> {
    const device = await this.repository.findById(deviceId);
    if (device?.tokenHash) {
      return safeEqual(hashToken(token), device.tokenHash) ? 'own' : false;
    }
    if (device?.tokenRevokedAt) return false;
    const shared = this.config.get('DEVICE_TOKEN', { infer: true });
    if (shared && safeEqual(token, shared)) {
      this.logger.warn({ event: 'legacy_token_used', deviceId });
      return 'legacy';
    }
    return false;
  }

  /** Creates the device if needed and gives it its first own token. */
  async register(deviceId: string): Promise<IssuedToken> {
    await this.repository.ensure(deviceId);
    const device = await this.repository.findById(deviceId);
    if (device?.tokenHash) throw new DeviceAlreadyRegisteredError(deviceId);
    const issued = await this.issue(deviceId);
    await this.eventLog.record('device.token_registered', { deviceId });
    return issued;
  }

  /** Replaces the token; the previous one stops working immediately. */
  async rotate(deviceId: string): Promise<IssuedToken> {
    if (!(await this.repository.findById(deviceId))) {
      throw new UnknownDeviceError(deviceId);
    }
    const issued = await this.issue(deviceId);
    this.dropConnection(deviceId);
    await this.eventLog.record('device.token_rotated', { deviceId });
    return issued;
  }

  /** Nothing is accepted for the device until a new token is issued. */
  async revoke(deviceId: string): Promise<void> {
    const updated = await this.repository.setToken(deviceId, {
      tokenHash: null,
      tokenCreatedAt: null,
      tokenRevokedAt: this.clock.now(),
    });
    if (!updated) throw new UnknownDeviceError(deviceId);
    this.dropConnection(deviceId);
    await this.eventLog.record('device.token_revoked', { deviceId });
  }

  async statusOf(deviceId: string): Promise<TokenStatus> {
    return tokenStatusOf(await this.repository.findById(deviceId));
  }

  private async issue(deviceId: string): Promise<IssuedToken> {
    const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    await this.repository.setToken(deviceId, {
      tokenHash: hashToken(token),
      tokenCreatedAt: this.clock.now(),
      tokenRevokedAt: null,
    });
    return { deviceId, token };
  }

  private dropConnection(deviceId: string): void {
    this.registry.get(deviceId)?.close(CLOSE_TOKEN_CHANGED, 'token changed');
  }
}
