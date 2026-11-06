import { REJECT_REASONS, validateDisplayLines } from '@gymtime/shared';
import {
  ALARM_LINES,
  DISPLAY_COLORS,
  SYSTEM_ERROR_LINES,
  deniedDisplay,
  entryDisplay,
  exitDisplay,
  unknownDisplay,
} from './display.js';

const LAYOUT = { cols: 16, rows: 2 };
const LONGEST_NAME = 'Maximiliano-Alex'; // 16 characters

const allDisplays = () => [
  entryDisplay(LONGEST_NAME),
  exitDisplay(LONGEST_NAME),
  unknownDisplay(),
  ...REJECT_REASONS.flatMap((reason) => [
    deniedDisplay(reason, LONGEST_NAME),
    deniedDisplay(reason, null),
  ]),
];

describe('scan displays (Anexo B)', () => {
  it('shows the display name and the result', () => {
    expect(entryDisplay('Ana M.')).toEqual({
      line1: 'Ana M.',
      line2: 'Entrada OK',
      color: DISPLAY_COLORS.accepted,
    });
    expect(exitDisplay('Ana M.')).toEqual({
      line1: 'Ana M.',
      line2: 'Salida OK',
      color: DISPLAY_COLORS.accepted,
    });
  });

  it('explains each rejection with the catalogue texts', () => {
    expect(deniedDisplay('ALREADY_EXITED', 'Ana')).toEqual({
      line1: 'Ana',
      line2: 'Ya marco salida',
      color: DISPLAY_COLORS.rejected,
    });
    expect(deniedDisplay('NOT_IN_SCHEDULE', 'Ana').line2).toBe(
      'No es su horario',
    );
    expect(deniedDisplay('STUDENT_INACTIVE', 'Ana').line2).toBe(
      'No habilitado',
    );
    expect(deniedDisplay('NO_ACTIVE_SCHEDULE', 'Ana')).toMatchObject({
      line1: 'Sin horario',
      line2: 'en este momento',
    });
    expect(deniedDisplay('OUTSIDE_ENTRY_WINDOW', 'Ana')).toMatchObject({
      line1: 'Ingreso cerrado',
      line2: '',
    });
    expect(deniedDisplay('UNKNOWN_SLOT', null)).toMatchObject({
      line1: 'No reconocida',
      line2: 'Intente de nuevo',
    });
  });

  it('announces an unrecognised fingerprint like an unknown slot', () => {
    expect(unknownDisplay()).toEqual({
      line1: 'No reconocida',
      line2: 'Intente de nuevo',
      color: DISPLAY_COLORS.rejected,
    });
  });

  it('keeps every line of every result within 16 characters of ASCII (R11)', () => {
    for (const display of allDisplays()) {
      const checked = validateDisplayLines(
        [display.line1, display.line2],
        LAYOUT,
      );
      expect(checked).toEqual({
        ok: true,
        lines: [display.line1, display.line2],
      });
    }
  });

  it('keeps the reserved and alarm texts within the screen', () => {
    for (const lines of [SYSTEM_ERROR_LINES, ALARM_LINES]) {
      expect(validateDisplayLines([lines.line1, lines.line2], LAYOUT).ok).toBe(
        true,
      );
    }
  });

  it('cuts to a narrower screen and drops the second line on a single row', () => {
    expect(entryDisplay(LONGEST_NAME, { cols: 8, rows: 2 })).toMatchObject({
      line1: 'Maximili',
      line2: 'Entrada ',
    });
    expect(entryDisplay('Ana', { cols: 16, rows: 1 }).line2).toBe('');
  });
});
