import { formatBogota } from '../time.js';
import { noPositionals } from './args.js';
import type { Command } from './types.js';

export const ALARM_REASONS = [
  'END_BEEP',
  'PENDING_EXIT',
  'MANUAL',
  'TEST',
  'CLEARED',
] as const;
export type AlarmReason = (typeof ALARM_REASONS)[number];

export const ALARM_CLOSED_BY = [
  'all_exited',
  'button',
  'cli',
  'timeout',
] as const;
export type AlarmClosedBy = (typeof ALARM_CLOSED_BY)[number];

export interface AlarmStatus {
  on: boolean;
  reason: AlarmReason | null;
  instanceId: string | null;
  durationSec: number | null;
  startedAt: string | null;
  openSessions: number;
}

export interface AlarmOffResult {
  closedBy: AlarmClosedBy;
  sessionsClosed: number;
  status: AlarmStatus;
}

/** Operator-facing detail shared by the four alarm commands. */
export function describeAlarmStatus(status: AlarmStatus): string {
  const state = status.on
    ? `ON (${status.reason ?? '-'})`
    : `OFF${status.reason ? ` (last ${status.reason})` : ''}`;
  return [
    `alarm:          ${state}`,
    `instance:       ${status.instanceId ?? '-'}`,
    `duration:       ${
      status.durationSec === null ? 'continuous' : `${status.durationSec} s`
    }`,
    `since (Bogota): ${
      status.startedAt ? formatBogota(status.startedAt) : '-'
    }`,
    `open sessions:  ${status.openSessions}`,
  ].join('\n');
}

const statusCommand: Command = {
  group: 'alarm',
  action: 'status',
  summary: 'Show the siren state, reason and open sessions',
  usage: 'alarm status',
  async run({ http, io, positionals }) {
    noPositionals(positionals);
    const status = await http.request<AlarmStatus>('GET', '/alarm/status');
    io.out(describeAlarmStatus(status));
    return 0;
  },
};

const on: Command = {
  group: 'alarm',
  action: 'on',
  summary: 'Turn the siren on continuously (reason MANUAL)',
  usage: 'alarm on',
  async run({ http, io, positionals }) {
    noPositionals(positionals);
    const status = await http.request<AlarmStatus>('POST', '/alarm/on');
    io.out('Alarm on.');
    io.out(describeAlarmStatus(status));
    return 0;
  },
};

const off: Command = {
  group: 'alarm',
  action: 'off',
  summary: 'Silence the siren and mark the open sessions no_registrada',
  usage: 'alarm off',
  async run({ http, io, positionals }) {
    noPositionals(positionals);
    const result = await http.request<AlarmOffResult>('POST', '/alarm/off');
    io.out(
      `Alarm off (${result.closedBy}); ${result.sessionsClosed} session(s) marked no_registrada.`,
    );
    io.out(describeAlarmStatus(result.status));
    return 0;
  },
};

const test: Command = {
  group: 'alarm',
  action: 'test',
  summary: 'Sound the short test beep (reason TEST)',
  usage: 'alarm test',
  async run({ http, io, positionals }) {
    noPositionals(positionals);
    const status = await http.request<AlarmStatus>('POST', '/alarm/test');
    io.out('Alarm test started.');
    io.out(describeAlarmStatus(status));
    return 0;
  },
};

export const alarmCommands: readonly Command[] = [on, off, test, statusCommand];
