import { enrollCommands } from './enroll.js';
import { studentCommands } from './student.js';
import type { Command } from './types.js';

export const COMMANDS: readonly Command[] = [
  ...studentCommands,
  ...enrollCommands,
];

export const GROUP_SUMMARIES: Record<string, string> = {
  student: 'Manage students',
  enroll: 'Enroll fingerprints through the device',
};
