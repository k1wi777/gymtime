import { CliError } from '../errors.js';
import { noPositionals, required } from './args.js';
import { describeSession, type Session } from './sessions.js';
import { findStudentByDocument } from './student.js';
import type { Command, CommandContext } from './types.js';

/** Both actions share the flow: resolve the document and post with a reason. */
async function register(
  action: 'entry' | 'exit',
  ctx: CommandContext,
): Promise<number> {
  noPositionals(ctx.positionals);
  const document = required(ctx.values['student'], '--student');
  const reason = required(ctx.values['reason'], '--reason');
  const student = await findStudentByDocument(ctx.http, document);
  if (!student) throw new CliError(`No student with document ${document}`);
  const session = await ctx.http.request<Session>(
    'POST',
    `/attendance/${action}`,
    { studentId: student.id, reason },
  );
  ctx.io.out(action === 'entry' ? 'Entry registered.' : 'Exit registered.');
  ctx.io.out(describeSession(session));
  return 0;
}

const entry: Command = {
  group: 'attendance',
  action: 'entry',
  summary: 'Register an entry manually (the reason is mandatory)',
  usage: 'attendance entry --student <doc> --reason <text>',
  options: { student: { type: 'string' }, reason: { type: 'string' } },
  run: (ctx) => register('entry', ctx),
};

const exit: Command = {
  group: 'attendance',
  action: 'exit',
  summary: 'Register an exit manually (the reason is mandatory)',
  usage: 'attendance exit --student <doc> --reason <text>',
  options: { student: { type: 'string' }, reason: { type: 'string' } },
  run: (ctx) => register('exit', ctx),
};

export const attendanceCommands: readonly Command[] = [entry, exit];
