import { attendanceCommands } from './attendance.js';
import { enrollCommands } from './enroll.js';
import { scheduleCommands } from './schedule.js';
import { sessionsCommands } from './sessions.js';
import { studentCommands } from './student.js';
import { syncCommands } from './sync.js';
import type { Command } from './types.js';

export const COMMANDS: readonly Command[] = [
  ...studentCommands,
  ...enrollCommands,
  ...scheduleCommands,
  ...syncCommands,
  ...sessionsCommands,
  ...attendanceCommands,
];

export const GROUP_SUMMARIES: Record<string, string> = {
  student: 'Manage students',
  enroll: 'Enroll fingerprints through the device',
  schedule: 'Manage schedules and their students',
  sync: 'Load templates and the current schedule into the reader',
  sessions: 'Inspect attendance sessions',
  attendance: 'Register entries and exits manually',
};
