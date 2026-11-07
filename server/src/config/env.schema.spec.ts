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
      DISPLAY_COLS: 16,
      DISPLAY_ROWS: 2,
      DISPLAY_RESULT_SECONDS: 3,
    });
  });

  it('reads the schedule and sync minutes and rejects negatives', () => {
    const env = validateEnv({ ...valid(), ENTRY_OPEN_MINUTES: '20' });
    expect(env.ENTRY_OPEN_MINUTES).toBe(20);
    expect(() => validateEnv({ ...valid(), SYNC_LEAD_MINUTES: '-1' })).toThrow(
      /SYNC_LEAD_MINUTES/,
    );
  });

  it('reads the display settings and rejects out-of-range values', () => {
    const env = validateEnv({
      ...valid(),
      DISPLAY_COLS: '20',
      DISPLAY_ROWS: '4',
      DISPLAY_RESULT_SECONDS: '5',
    });
    expect(env).toMatchObject({
      DISPLAY_COLS: 20,
      DISPLAY_ROWS: 4,
      DISPLAY_RESULT_SECONDS: 5,
    });
    for (const name of [
      'DISPLAY_COLS',
      'DISPLAY_ROWS',
      'DISPLAY_RESULT_SECONDS',
    ]) {
      expect(() => validateEnv({ ...valid(), [name]: '0' })).toThrow(
        new RegExp(name),
      );
    }
  });

  it('reads the alarm settings and rejects out-of-range values', () => {
    const env = validateEnv({
      ...valid(),
      ALARM_BEEP_SECONDS: '3',
      ALARM_TIMEOUT_MINUTES: '10',
    });
    expect(env.ALARM_BEEP_SECONDS).toBe(3);
    expect(env.ALARM_TIMEOUT_MINUTES).toBe(10);
    expect(() => validateEnv({ ...valid(), ALARM_BEEP_SECONDS: '0' })).toThrow(
      /ALARM_BEEP_SECONDS/,
    );
    expect(() =>
      validateEnv({ ...valid(), ALARM_TIMEOUT_MINUTES: '0' }),
    ).toThrow(/ALARM_TIMEOUT_MINUTES/);
  });

  it('names the missing variable', () => {
    const { ADMIN_API_KEY: _omitted, ...rest } = valid();
    expect(() => validateEnv(rest)).toThrow(/ADMIN_API_KEY: is missing/);
  });

  it('DEVICE_TOKEN is optional since H11 but, when set, must be long enough', () => {
    const { DEVICE_TOKEN: _omitted, ...rest } = valid();
    expect(validateEnv(rest).DEVICE_TOKEN).toBeUndefined();
    expect(validateEnv({ ...rest, DEVICE_TOKEN: '' }).DEVICE_TOKEN).toBe(
      undefined,
    );
    expect(() => validateEnv({ ...rest, DEVICE_TOKEN: 'short' })).toThrow(
      /DEVICE_TOKEN: must be at least 16/,
    );
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

  describe('panel accounts (R24)', () => {
    it('defaults to strict cookies, no cross origin and the documented limits', () => {
      const env = validateEnv(valid());
      expect(env.COOKIE_DOMAIN).toBeUndefined();
      expect(env.FIRST_ADMIN_USERNAME).toBeUndefined();
      expect(env).toMatchObject({
        COOKIE_SAMESITE: 'Strict',
        CORS_ORIGINS: [],
        SESSION_IDLE_MINUTES: 30,
        SESSION_MAX_HOURS: 8,
        LOGIN_MAX_ATTEMPTS: 5,
        LOGIN_LOCK_MINUTES: 15,
        LOGIN_RATE_LIMIT: 10,
        TRUST_PROXY: 0,
      });
    });

    it('treats empty assignments as unset', () => {
      const env = validateEnv({
        ...valid(),
        COOKIE_DOMAIN: '',
        COOKIE_SAMESITE: '',
        CORS_ORIGINS: '',
        FIRST_ADMIN_USERNAME: '',
        FIRST_ADMIN_PASSWORD: '',
      });
      expect(env.COOKIE_SAMESITE).toBe('Strict');
      expect(env.CORS_ORIGINS).toEqual([]);
    });

    it('parses a list of exact origins', () => {
      const env = validateEnv({
        ...valid(),
        CORS_ORIGINS: 'http://localhost:3000, https://panel.example.org',
      });
      expect(env.CORS_ORIGINS).toEqual([
        'http://localhost:3000',
        'https://panel.example.org',
      ]);
    });

    it.each([
      '*',
      'http://localhost:3000/',
      'http://localhost:3000/panel',
      'localhost:3000',
      'ftp://x.org',
    ])('rejects %s as an origin', (value) => {
      expect(() => validateEnv({ ...valid(), CORS_ORIGINS: value })).toThrow(
        /CORS_ORIGINS: .*exact origin/,
      );
    });

    it('requires production for SameSite=None', () => {
      const raw = { ...valid(), COOKIE_SAMESITE: 'None' };
      expect(() => validateEnv(raw)).toThrow(/COOKIE_SAMESITE: None requires/);
      expect(
        validateEnv({ ...raw, NODE_ENV: 'production' }).COOKIE_SAMESITE,
      ).toBe('None');
    });

    it('rejects an unknown SameSite value', () => {
      expect(() =>
        validateEnv({ ...valid(), COOKIE_SAMESITE: 'Maybe' }),
      ).toThrow(/COOKIE_SAMESITE/);
    });

    it('accepts the first administrator only as a valid pair', () => {
      const pair = {
        FIRST_ADMIN_USERNAME: 'Admin',
        FIRST_ADMIN_PASSWORD: 'a-long-enough-password',
      };
      expect(validateEnv({ ...valid(), ...pair })).toMatchObject(pair);
      expect(() =>
        validateEnv({ ...valid(), FIRST_ADMIN_USERNAME: 'admin' }),
      ).toThrow(/FIRST_ADMIN_PASSWORD.*go together/s);
      expect(() =>
        validateEnv({
          ...valid(),
          FIRST_ADMIN_PASSWORD: 'a-long-enough-password',
        }),
      ).toThrow(/go together/);
    });

    it('applies the password policy without echoing the password', () => {
      const raw = {
        ...valid(),
        FIRST_ADMIN_USERNAME: 'admin',
        FIRST_ADMIN_PASSWORD: 'short',
      };
      expect(() => validateEnv(raw)).toThrow(
        /FIRST_ADMIN_PASSWORD: .*too_short/,
      );
      try {
        validateEnv(raw);
      } catch (error) {
        expect(String(error)).not.toContain('short\n');
        expect(String(error)).not.toMatch(/FIRST_ADMIN_PASSWORD: short/);
      }
    });

    it('rejects a first administrator password equal to the username', () => {
      expect(() =>
        validateEnv({
          ...valid(),
          FIRST_ADMIN_USERNAME: 'administrador',
          FIRST_ADMIN_PASSWORD: 'Administrador',
        }),
      ).toThrow(/same_as_username/);
    });
  });
});

describe('key ring variables (H11)', () => {
  const key = () => randomBytes(32).toString('base64');

  it('defaults to version 1 and no retired keys: existing deployments do not change', () => {
    expect(validateEnv(valid())).toMatchObject({
      ENCRYPTION_KEY_VERSION: 1,
      ENCRYPTION_KEYS_RETIRED: [],
    });
  });

  it('parses retired keys by version', () => {
    const [a, b] = [key(), key()];
    const env = validateEnv({
      ...valid(),
      ENCRYPTION_KEY_VERSION: '3',
      ENCRYPTION_KEYS_RETIRED: `1:${a}, 2:${b}`,
    });
    expect(env.ENCRYPTION_KEY_VERSION).toBe(3);
    expect(env.ENCRYPTION_KEYS_RETIRED).toEqual([
      { version: 1, key: a },
      { version: 2, key: b },
    ]);
  });

  it('rejects malformed, duplicated or current-version entries without echoing keys', () => {
    const secret = key();
    for (const retired of [
      `x:${secret}`,
      `1:${secret.slice(0, 10)}`,
      `1:${secret},1:${key()}`,
      `1:${secret}`, // current version is 1 by default
    ]) {
      let message = '';
      try {
        validateEnv({ ...valid(), ENCRYPTION_KEYS_RETIRED: retired });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/ENCRYPTION_KEYS_RETIRED/);
      expect(message).not.toContain(secret);
    }
  });
});

describe('ENABLE_DOCS', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    ADMIN_API_KEY: 'admin-key-1234567890',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  };
  it('defaults to false and accepts true', () => {
    expect(validateEnv(base).ENABLE_DOCS).toBe(false);
    expect(validateEnv({ ...base, ENABLE_DOCS: 'true' }).ENABLE_DOCS).toBe(
      true,
    );
    expect(validateEnv({ ...base, ENABLE_DOCS: '' }).ENABLE_DOCS).toBe(false);
  });
});
