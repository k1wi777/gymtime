import { UsageError, CliError } from '../errors.js';
import { HttpError, type HttpClient } from '../http.js';
import { formatTable, yesNo } from '../output.js';
import { noPositionals, required } from './args.js';
import type { Command, CommandContext } from './types.js';

export interface Student {
  id: string;
  document: string;
  name: string;
  program: string | null;
  active: boolean;
  consented: boolean;
}

/**
 * The API addresses students by UUID and cannot filter by document, so the
 * document is resolved on the client over the full list (inactive included).
 */
export async function findStudentByDocument(
  http: HttpClient,
  document: string,
): Promise<Student | undefined> {
  const students = await http.request<Student[]>('GET', '/students');
  return students.find((student) => student.document === document);
}

export function describeStudent(student: Student): string {
  return [
    `id:         ${student.id}`,
    `document:   ${student.document}`,
    `name:       ${student.name}`,
    `program:    ${student.program ?? '-'}`,
    `active:     ${yesNo(student.active)}`,
    `consented:  ${yesNo(student.consented)}`,
  ].join('\n');
}

const add: Command = {
  group: 'student',
  action: 'add',
  summary: 'Register a student',
  usage:
    'student add --document <doc> --name <name> [--program <program>] [--consented]',
  options: {
    document: { type: 'string' },
    name: { type: 'string' },
    program: { type: 'string' },
    consented: { type: 'boolean' },
  },
  async run({ http, io, values, positionals }) {
    noPositionals(positionals);
    const document = required(values['document'], '--document');
    const name = required(values['name'], '--name');
    try {
      const student = await http.request<Student>('POST', '/students', {
        document,
        name,
        program: values['program'] ?? null,
        consented: values['consented'] === true,
      });
      io.out('Student created.');
      io.out(describeStudent(student));
      return 0;
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        throw new CliError(
          `A student with document ${document} already exists`,
        );
      }
      throw error;
    }
  },
};

const list: Command = {
  group: 'student',
  action: 'list',
  summary: 'List students',
  usage: 'student list [--active true|false]',
  options: { active: { type: 'string' } },
  async run({ http, io, values, positionals }) {
    noPositionals(positionals);
    const active = values['active'];
    if (active !== undefined && active !== 'true' && active !== 'false') {
      throw new UsageError('--active must be "true" or "false"');
    }
    const query = active === undefined ? '' : `?active=${active}`;
    const students = await http.request<Student[]>('GET', `/students${query}`);
    if (students.length === 0) {
      io.out('No students found.');
      return 0;
    }
    io.out(
      formatTable(
        ['DOCUMENT', 'NAME', 'PROGRAM', 'ACTIVE', 'CONSENT'],
        students.map((s) => [
          s.document,
          s.name,
          s.program ?? '-',
          yesNo(s.active),
          yesNo(s.consented),
        ]),
      ),
    );
    return 0;
  },
};

const remove: Command = {
  group: 'student',
  action: 'remove',
  summary: 'Deactivate a student (its fingerprint is erased)',
  usage: 'student remove <document>',
  async run({ http, io, positionals }: CommandContext) {
    const [document, ...extra] = positionals;
    if (document === undefined || extra.length > 0) {
      throw new UsageError('expected exactly one <document>');
    }
    const student = await findStudentByDocument(http, document);
    if (!student) {
      throw new CliError(`No student with document ${document}`);
    }
    await http.request('DELETE', `/students/${student.id}`);
    io.out(`Student ${student.name} (${document}) deactivated.`);
    return 0;
  },
};

export const studentCommands: readonly Command[] = [add, list, remove];
