import { CliError, UsageError } from '../errors.js';
import { formatTable, yesNo } from '../output.js';
import { formatBogota, shortTime } from '../time.js';
import { noPositionals, required } from './args.js';
import { findStudentByDocument, type Student } from './student.js';
import type { Command, CommandContext } from './types.js';

interface Instance {
  id: string;
  date: string;
  startsAt: string;
  endsAt: string;
}

interface ScheduleStudent {
  id: string;
  document: string;
  name: string;
  active: boolean;
}

interface Schedule {
  id: string;
  name: string;
  weekday: number | null;
  date: string | null;
  startTime: string;
  endTime: string;
  entryOpenMinutes: number | null;
  entryCloseMinutes: number | null;
  periodId?: string | null;
  students: ScheduleStudent[];
  upcoming: Instance[];
}

interface Period {
  id: string;
  name: string;
  active: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `--period` takes the id or the exact name of the period. */
async function resolvePeriodId(
  ctx: CommandContext,
  value: unknown,
): Promise<string | undefined> {
  if (value === undefined) return undefined;
  const wanted = required(value, '--period');
  if (UUID.test(wanted)) return wanted;
  const periods = await ctx.http.request<Period[]>('GET', '/periods');
  const found = periods.find((p) => p.name === wanted);
  if (!found) throw new CliError(`No period named "${wanted}"`);
  return found.id;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Mirrors the server default SYNC_LEAD_MINUTES; only used to word a hint. */
const SYNC_LEAD_MS = 15 * 60_000;

/** `3m` or `3` -> 3 minutes. */
export function parseEndsIn(value: string): number {
  const match = /^(\d+)m?$/.exec(value.trim());
  const minutes = match ? Number(match[1]) : 0;
  if (minutes < 1) {
    throw new UsageError('--ends-in must be a number of minutes such as 3m');
  }
  return minutes;
}

function integer(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new UsageError(`${flag} must be a whole number`);
  }
  return Number(value);
}

function documents(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** Request body from the flags; the server does the business validation. */
function buildBody(ctx: CommandContext): Record<string, unknown> {
  const { values } = ctx;
  const name = required(values['name'], '--name');
  const endsIn = values['ends-in'];
  const definition = [
    'weekday',
    'date',
    'start',
    'end',
    'entry-open',
    'entry-close',
  ];
  if (endsIn !== undefined) {
    if (definition.some((flag) => values[flag] !== undefined)) {
      throw new UsageError(
        '--ends-in cannot be combined with --weekday, --date, --start, --end or the entry options',
      );
    }
    return { name, endsInMinutes: parseEndsIn(String(endsIn)) };
  }
  const weekday = integer(values['weekday'], '--weekday');
  const date = values['date'];
  if ((weekday === undefined) === (date === undefined)) {
    throw new UsageError('give exactly one of --weekday (1-7) or --date');
  }
  return {
    name,
    weekday,
    date,
    start: required(values['start'], '--start'),
    end: required(values['end'], '--end'),
    entryOpenMinutes: integer(values['entry-open'], '--entry-open'),
    entryCloseMinutes: integer(values['entry-close'], '--entry-close'),
  };
}

const create: Command = {
  group: 'schedule',
  action: 'create',
  summary:
    'Create a schedule (times in Bogota); --ends-in makes a quick test one',
  usage:
    'schedule create --name <name> (--weekday 1-7 | --date YYYY-MM-DD) --start HH:mm --end HH:mm [--period <id|name>] [--student <doc>]... [--entry-open <min>] [--entry-close <min>]\n' +
    '      schedule create --name <name> --ends-in 3m [--student <doc>]...',
  options: {
    name: { type: 'string' },
    weekday: { type: 'string' },
    date: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
    'ends-in': { type: 'string' },
    period: { type: 'string' },
    student: { type: 'string', multiple: true },
    'entry-open': { type: 'string' },
    'entry-close': { type: 'string' },
  },
  async run(ctx) {
    noPositionals(ctx.positionals);
    const body = buildBody(ctx);
    // A weekly schedule belongs to a period; one-off and quick ones do not.
    const periodId = await resolvePeriodId(ctx, ctx.values['period']);
    if (periodId) body['periodId'] = periodId;
    // Resolve every student first so a typo does not leave a half-built schedule.
    const students = await resolveStudents(
      ctx,
      documents(ctx.values['student']),
    );
    const created = await ctx.http.request<Schedule>(
      'POST',
      '/schedules',
      body,
    );
    ctx.io.out('Schedule created.');
    for (const student of students) {
      await ctx.http.request(
        'PUT',
        `/schedules/${created.id}/students/${student.id}`,
      );
    }
    const shown = students.length
      ? await ctx.http.request<Schedule>('GET', `/schedules/${created.id}`)
      : created;
    ctx.io.out(describeSchedule(shown));
    if (needsManualSync(shown, ctx.now())) {
      ctx.io.out(
        '\nThis schedule starts too soon for the automatic sync (15 min before the start).\n' +
          'Run `gym sync` to load it into the reader now.',
      );
    }
    return 0;
  },
};

const assign: Command = {
  group: 'schedule',
  action: 'assign',
  summary: 'Assign a student to a schedule',
  usage: 'schedule assign --schedule <id> --student <doc>',
  options: { schedule: { type: 'string' }, student: { type: 'string' } },
  async run(ctx) {
    noPositionals(ctx.positionals);
    const id = required(ctx.values['schedule'], '--schedule');
    const document = required(ctx.values['student'], '--student');
    const [student] = await resolveStudents(ctx, [document]);
    await ctx.http.request(
      'PUT',
      `/schedules/${encodeURIComponent(id)}/students/${student?.id}`,
    );
    ctx.io.out(`Student ${student?.name} (${document}) assigned to ${id}.`);
    return 0;
  },
};

const list: Command = {
  group: 'schedule',
  action: 'list',
  summary: 'List schedules',
  usage: 'schedule list',
  async run({ http, io, positionals }) {
    noPositionals(positionals);
    const schedules = await http.request<Schedule[]>('GET', '/schedules');
    if (schedules.length === 0) {
      io.out('No schedules found.');
      return 0;
    }
    io.out(
      formatTable(
        ['ID', 'NAME', 'WHEN (Bogota)', 'STUDENTS', 'NEXT'],
        schedules.map((s) => [
          s.id,
          s.name,
          when(s),
          String(s.students.length),
          s.upcoming[0] ? formatBogota(s.upcoming[0].startsAt) : '-',
        ]),
      ),
    );
    return 0;
  },
};

const show: Command = {
  group: 'schedule',
  action: 'show',
  summary: 'Show a schedule with its students and upcoming dates',
  usage: 'schedule show --schedule <id>',
  options: { schedule: { type: 'string' } },
  async run({ http, io, values, positionals }) {
    noPositionals(positionals);
    const id = required(values['schedule'], '--schedule');
    const schedule = await http.request<Schedule>(
      'GET',
      `/schedules/${encodeURIComponent(id)}`,
    );
    io.out(describeSchedule(schedule));
    return 0;
  },
};

export const scheduleCommands: readonly Command[] = [
  create,
  assign,
  list,
  show,
];

async function resolveStudents(
  ctx: CommandContext,
  docs: string[],
): Promise<Student[]> {
  const found: Student[] = [];
  for (const document of docs) {
    const student = await findStudentByDocument(ctx.http, document);
    if (!student) throw new CliError(`No student with document ${document}`);
    found.push(student);
  }
  return found;
}

function when(s: Schedule): string {
  const day = s.date ?? WEEKDAYS[(s.weekday ?? 1) - 1] ?? '?';
  return `${day} ${shortTime(s.startTime)}-${shortTime(s.endTime)}`;
}

/** True when the first occurrence is in progress or inside the sync lead time. */
function needsManualSync(schedule: Schedule, nowMs: number): boolean {
  return schedule.upcoming.some(
    (i) =>
      Date.parse(i.startsAt) - SYNC_LEAD_MS <= nowMs &&
      nowMs < Date.parse(i.endsAt),
  );
}

function describeSchedule(s: Schedule): string {
  const lines = [
    `id:         ${s.id}`,
    `name:       ${s.name}`,
    `when:       ${when(s)} (Bogota)`,
    `entry:      opens ${s.entryOpenMinutes ?? 'default'} min before the start, closes ${s.entryCloseMinutes ?? 'default'} min before the end`,
    `students:   ${s.students.length}`,
  ];
  if (s.students.length > 0) {
    lines.push(
      '',
      formatTable(
        ['DOCUMENT', 'NAME', 'ACTIVE'],
        s.students.map((st) => [st.document, st.name, yesNo(st.active)]),
      ),
    );
  }
  lines.push('', 'upcoming:');
  lines.push(
    ...(s.upcoming.length > 0
      ? s.upcoming.map(
          (i) =>
            `  ${formatBogota(i.startsAt)} - ${formatBogota(i.endsAt).slice(11)}`,
        )
      : ['  none']),
  );
  return lines.join('\n');
}
