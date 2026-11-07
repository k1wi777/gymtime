import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WIPE_ORDER, WIPE_TABLES, wipeAll } from './wipe.js';

const ENUM_MAPS = new Set([
  'enrollment_status',
  'session_status',
  'attendance_source',
  'command_status',
  'actor_type',
  'panel_role',
  'alarm_origin',
  'alarm_closed_by',
]);

/** Tables of the Prisma schema (`@@map` names that are not enums). */
function schemaTables(): string[] {
  const schema = readFileSync(
    resolve(import.meta.dirname, '../../prisma/schema.prisma'),
    'utf8',
  );
  return [...schema.matchAll(/@@map\("([a-z_]+)"\)/g)]
    .map((m) => m[1]!)
    .filter((name) => !ENUM_MAPS.has(name));
}

describe('wipe order', () => {
  it('covers every table of the schema exactly once', () => {
    expect([...WIPE_TABLES].sort()).toEqual(schemaTables().sort());
    expect(new Set(WIPE_TABLES).size).toBe(WIPE_TABLES.length);
    expect(WIPE_TABLES).toHaveLength(20);
  });

  it('never lists the migrations table', () => {
    expect(WIPE_TABLES).not.toContain('_prisma_migrations');
  });

  it('deletes children before the rows they reference', () => {
    const at = (name: string) => WIPE_TABLES.indexOf(name);
    const before = (child: string, parent: string) =>
      expect(at(child), `${child} before ${parent}`).toBeLessThan(at(parent));
    before('offline_events', 'attendance_sessions');
    before('alarm_events', 'schedule_instances');
    before('attendance_sessions', 'schedule_instances');
    before('schedule_students', 'schedules');
    before('schedules', 'periods');
    before('device_slots', 'fingerprints');
    before('fingerprints', 'students');
    before('processed_messages', 'devices');
    before('device_commands', 'devices');
    before('enrollments', 'devices');
    before('auth_sessions', 'panel_users');
  });

  it('calls deleteMany once per table, in order, and reports the counts', async () => {
    const calls: string[] = [];
    const delegate = (model: string) => ({
      count: async () => 0,
      deleteMany: async () => {
        calls.push(model);
        return { count: calls.length };
      },
    });
    const db = new Proxy({}, { get: (_t, model: string) => delegate(model) });
    const removed = await wipeAll(db as never);
    expect(calls).toHaveLength(WIPE_ORDER.length);
    expect(Object.keys(removed)).toEqual([...WIPE_TABLES]);
    expect(removed.offline_events).toBe(1);
  });
});
