import { CliError, UsageError } from '../errors.js';
import { formatTable } from '../output.js';
import { formatBogota } from '../time.js';
import { noPositionals } from './args.js';
import { findStudentByDocument } from './student.js';
import type { Command } from './types.js';

export const SESSION_STATUSES = [
  'abierta',
  'cerrada',
  'no_registrada',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface SessionStudent {
  id: string;
  document: string;
  name: string;
}

export interface SessionInstance {
  id: string;
  scheduleId: string;
  startsAt: string;
  endsAt: string;
}

export interface OpenSession {
  id: string;
  student: SessionStudent;
  enteredAt: string;
  instance: SessionInstance;
}

export interface Session extends OpenSession {
  exitedAt: string | null;
  entrySource: 'device' | 'manual';
  exitSource: 'device' | 'manual' | null;
  status: SessionStatus;
  manualReason: string | null;
}

/** Operator-facing detail of one session (shared with `attendance`). */
export function describeSession(session: Session): string {
  const lines = [
    `id:        ${session.id}`,
    `student:   ${session.student.name} (${session.student.document})`,
    `status:    ${session.status}`,
    `entered:   ${formatBogota(session.enteredAt)} (${session.entrySource})`,
    `exited:    ${
      session.exitedAt
        ? `${formatBogota(session.exitedAt)} (${session.exitSource ?? '-'})`
        : '-'
    }`,
    `schedule:  ${formatBogota(session.instance.startsAt)} - ${formatBogota(
      session.instance.endsAt,
    ).slice(11)}`,
  ];
  if (session.manualReason) lines.push(`reason:    ${session.manualReason}`);
  return lines.join('\n');
}

function scheduleRange(instance: SessionInstance): string {
  return `${formatBogota(instance.startsAt)} - ${formatBogota(instance.endsAt).slice(11)}`;
}

const open: Command = {
  group: 'sessions',
  action: 'open',
  summary: 'List the students who are inside right now',
  usage: 'sessions open',
  async run({ http, io, positionals }) {
    noPositionals(positionals);
    const sessions = await http.request<OpenSession[]>(
      'GET',
      '/attendance/open',
    );
    if (sessions.length === 0) {
      io.out('Nobody is inside right now.');
      return 0;
    }
    io.out(
      formatTable(
        ['DOCUMENT', 'NAME', 'ENTERED (Bogota)', 'SCHEDULE'],
        sessions.map((session) => [
          session.student.document,
          session.student.name,
          formatBogota(session.enteredAt),
          scheduleRange(session.instance),
        ]),
      ),
    );
    return 0;
  },
};

function parseLimit(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new UsageError('--limit must be a whole number');
  }
  return value;
}

function parseStatus(value: unknown): SessionStatus | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !SESSION_STATUSES.includes(value as SessionStatus)
  ) {
    throw new UsageError(
      `--status must be one of ${SESSION_STATUSES.join(', ')}`,
    );
  }
  return value as SessionStatus;
}

const list: Command = {
  group: 'sessions',
  action: 'list',
  summary: 'List attendance sessions with optional filters',
  usage:
    'sessions list [--student <doc>] [--status abierta|cerrada|no_registrada] [--limit <n>]',
  options: {
    student: { type: 'string' },
    status: { type: 'string' },
    limit: { type: 'string' },
  },
  async run({ http, io, values, positionals }) {
    noPositionals(positionals);
    const params = new URLSearchParams();
    const document = values['student'];
    if (document !== undefined) {
      const text = String(document);
      const student = await findStudentByDocument(http, text);
      if (!student) throw new CliError(`No student with document ${text}`);
      params.set('studentId', student.id);
    }
    const status = parseStatus(values['status']);
    if (status) params.set('status', status);
    const limit = parseLimit(values['limit']);
    if (limit) params.set('limit', limit);

    const query = params.toString();
    const sessions = await http.request<Session[]>(
      'GET',
      `/attendance/sessions${query ? `?${query}` : ''}`,
    );
    if (sessions.length === 0) {
      io.out('No sessions found.');
      return 0;
    }
    io.out(
      formatTable(
        [
          'DOCUMENT',
          'NAME',
          'STATUS',
          'ENTERED',
          'EXITED',
          'SOURCES',
          'REASON',
        ],
        sessions.map((session) => [
          session.student.document,
          session.student.name,
          session.status,
          formatBogota(session.enteredAt),
          session.exitedAt ? formatBogota(session.exitedAt) : '-',
          session.exitSource
            ? `${session.entrySource}->${session.exitSource}`
            : session.entrySource,
          session.manualReason ?? '-',
        ]),
      ),
    );
    return 0;
  },
};

export const sessionsCommands: readonly Command[] = [open, list];
