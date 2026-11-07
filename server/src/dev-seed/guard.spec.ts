import { describe, expect, it } from 'vitest';
import {
  UnsafeDatabaseError,
  assertDevDatabase,
  describeTarget,
  isConfirmed,
} from './guard.js';

const url = (host: string, db: string, query = '') =>
  `postgresql://user:secret@${host}:5432/${db}${query}`;
const check = (databaseUrl: string | undefined, nodeEnv = 'development') =>
  assertDevDatabase({ nodeEnv, databaseUrl });

describe('assertDevDatabase', () => {
  it.each([
    ['localhost', 'gymtime'],
    ['127.0.0.1', 'gymtime'],
    ['[::1]', 'gymtime'],
    ['localhost', 'gymtime_demo'],
    ['localhost', 'gymtime_seed_dev_check_123'],
    ['localhost', 'my_test'],
    ['localhost', 'gym_dev'],
    ['localhost', 'SEED_copy'],
  ])('accepts %s/%s', (host, db) => {
    expect(check(url(host, db)).database).toBe(db);
  });

  it.each([
    ['postgres', 'gymtime'],
    ['db.example.com', 'gymtime'],
    ['10.0.0.5', 'gymtime'],
    ['192.168.1.20', 'gymtime_demo'],
    ['localhost.evil.com', 'gymtime'],
  ])('refuses the non-local host %s', (host, db) => {
    expect(() => check(url(host, db))).toThrow(UnsafeDatabaseError);
  });

  it.each(['gymtime_prod', 'production', 'gymtime2', 'postgres', 'app'])(
    'refuses the database %s',
    (db) => {
      expect(() => check(url('localhost', db))).toThrow(
        /no es la de desarrollo/,
      );
    },
  );

  it('refuses production, a missing URL and a host hidden in the query', () => {
    expect(() => check(url('localhost', 'gymtime'), 'production')).toThrow(
      /producción/,
    );
    expect(() => check(undefined)).toThrow(/DATABASE_URL/);
    expect(() =>
      check(url('localhost', 'gymtime', '?host=db.example.com')),
    ).toThrow(/host/);
    expect(() => check('not a url')).toThrow(UnsafeDatabaseError);
  });

  it('never puts the credentials in what it shows or throws', () => {
    const target = check(url('localhost', 'gymtime'));
    expect(describeTarget(target)).toBe('localhost:5432/gymtime');
    try {
      check(url('db.example.com', 'gymtime'));
    } catch (error) {
      expect(String(error)).not.toContain('secret');
    }
  });
});

describe('isConfirmed', () => {
  const target = { host: 'localhost', port: '5432', database: 'gymtime' };

  it('needs the exact database name', () => {
    expect(isConfirmed(target, 'gymtime')).toBe(true);
    expect(isConfirmed(target, ' gymtime \n')).toBe(true);
    for (const answer of [
      undefined,
      '',
      'yes',
      'si',
      'GYMTIME',
      'gymtime_demo',
    ]) {
      expect(isConfirmed(target, answer)).toBe(false);
    }
  });
});
