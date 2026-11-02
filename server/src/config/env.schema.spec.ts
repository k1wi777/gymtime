import { randomBytes } from 'node:crypto';
import { validateEnv } from './env.schema.js';

const valid = () => ({
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  DEVICE_TOKEN: 'device-token-123456',
  ADMIN_API_KEY: 'admin-key-1234567890',
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

describe('validateEnv', () => {
  it('applies defaults to optional variables', () => {
    const env = validateEnv(valid());
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      ENTRY_OPEN_MINUTES: 10,
      ENTRY_CLOSE_MINUTES: 5,
      SYNC_LEAD_MINUTES: 15,
      ALARM_BEEP_SECONDS: 5,
      ALARM_TIMEOUT_MINUTES: 30,
    });
  });

  it('reads the schedule and sync minutes and rejects negatives', () => {
    const env = validateEnv({ ...valid(), ENTRY_OPEN_MINUTES: '20' });
    expect(env.ENTRY_OPEN_MINUTES).toBe(20);
    expect(() => validateEnv({ ...valid(), SYNC_LEAD_MINUTES: '-1' })).toThrow(
      /SYNC_LEAD_MINUTES/,
    );
  });

  it('reads the alarm settings and rejects out-of-range values', () => {
    const env = validateEnv({
      ...valid(),
      ALARM_BEEP_SECONDS: '3',
      ALARM_TIMEOUT_MINUTES: '10',
    });
    expect(env.ALARM_BEEP_SECONDS).toBe(3);
    expect(env.ALARM_TIMEOUT_MINUTES).toBe(10);
    expect(() =>
      validateEnv({ ...valid(), ALARM_BEEP_SECONDS: '0' }),
    ).toThrow(/ALARM_BEEP_SECONDS/);
    expect(() =>
      validateEnv({ ...valid(), ALARM_TIMEOUT_MINUTES: '0' }),
    ).toThrow(/ALARM_TIMEOUT_MINUTES/);
  });

  it('names the missing variable', () => {
    const { DEVICE_TOKEN: _omitted, ...rest } = valid();
    expect(() => validateEnv(rest)).toThrow(/DEVICE_TOKEN: is missing/);
  });

  it('lists every defective variable', () => {
    const raw = { ...valid(), DATABASE_URL: 'mysql://x', PORT: '99999' };
    expect(() => validateEnv(raw)).toThrow(/PORT:[\s\S]*DATABASE_URL:/);
  });

  it('rejects an encryption key that is not 32 bytes', () => {
    const raw = {
      ...valid(),
      ENCRYPTION_KEY: randomBytes(16).toString('base64'),
    };
    expect(() => validateEnv(raw)).toThrow(/ENCRYPTION_KEY: .*32 bytes/);
  });

  it('rejects short secrets without echoing their value', () => {
    const raw = { ...valid(), ADMIN_API_KEY: 'short' };
    expect(() => validateEnv(raw)).toThrow(
      /ADMIN_API_KEY: must be at least 16/,
    );
  });
});
