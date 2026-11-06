import { describe, expect, it } from 'vitest';
import {
  UnsafeDatabaseError,
  assertSafeDatabase,
  databaseName,
} from './safety.js';

const url = (db: string) =>
  `postgresql://u:p@localhost:5432/${db}?schema=public`;

describe('assertSafeDatabase', () => {
  it.each(['gymtime_demo', 'gymtime_seed_check', 'GYMTIME_TEST', 'demo'])(
    'accepts %s',
    (db) => {
      expect(assertSafeDatabase(url(db), undefined)).toBe(db);
    },
  );

  it.each(['gymtime', 'postgres', 'produccion'])('refuses %s', (db) => {
    expect(() => assertSafeDatabase(url(db), undefined)).toThrow(
      UnsafeDatabaseError,
    );
  });

  it('accepts a normal name only when SEED_ALLOW names it exactly', () => {
    expect(assertSafeDatabase(url('gymtime'), 'gymtime')).toBe('gymtime');
    expect(() => assertSafeDatabase(url('gymtime'), 'gym')).toThrow(
      UnsafeDatabaseError,
    );
  });

  it('refuses a missing or malformed URL', () => {
    expect(() => assertSafeDatabase(undefined, undefined)).toThrow(/definida/);
    expect(() => assertSafeDatabase('no-es-url', undefined)).toThrow(
      UnsafeDatabaseError,
    );
    expect(() =>
      assertSafeDatabase('postgresql://u:p@h:5432', undefined),
    ).toThrow(UnsafeDatabaseError);
  });

  it('reads the name without the query string', () => {
    expect(databaseName(url('mi_demo'))).toBe('mi_demo');
  });
});
