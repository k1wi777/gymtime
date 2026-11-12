import { REJECT_REASONS, validateDisplayMessage } from '@gymtime/shared';
import {
  ALARM_MESSAGE,
  CLEAR_MESSAGE,
  SYSTEM_ERROR_MESSAGE,
  deniedDisplay,
  entryDisplay,
  exitDisplay,
  unknownDisplay,
} from './display.js';

const LONGEST_NAME = 'Maximiliano-Alexander O.'; // 24 characters

const allDisplays = () => [
  entryDisplay(LONGEST_NAME),
  exitDisplay(LONGEST_NAME),
  unknownDisplay(),
  ...REJECT_REASONS.flatMap((reason) => [
    deniedDisplay(reason, LONGEST_NAME),
    deniedDisplay(reason, null),
  ]),
];

describe('scan displays (catalogue)', () => {
  it('shows the display name, the result and a success tone', () => {
    expect(entryDisplay('Ana M.')).toEqual({
      title: 'Ana M.',
      subtitle: 'Entrada registrada',
      tone: 'success',
      line1: 'Ana M.',
      line2: 'Entrada registrada',
      color: 'green',
    });
    expect(exitDisplay('Ñandú')).toMatchObject({
      title: 'Ñandú',
      subtitle: 'Salida registrada',
      tone: 'success',
    });
  });

  it('explains each rejection with its tone', () => {
    const expected: Record<string, [string, string, string]> = {
      UNKNOWN_SLOT: ['Huella no reconocida', 'Intente de nuevo', 'error'],
      NOT_IN_SCHEDULE: ['Ana', 'No es su horario', 'error'],
      NO_ACTIVE_SCHEDULE: [
        'Sin horario',
        'No hay un horario activo en este momento',
        'warning',
      ],
      OUTSIDE_ENTRY_WINDOW: [
        'Ingreso cerrado',
        'El ingreso a este horario ya terminó',
        'warning',
      ],
      ALREADY_EXITED: ['Ana', 'Ya registró su salida', 'warning'],
      STUDENT_INACTIVE: ['Ana', 'No está habilitado', 'error'],
    };
    for (const reason of REJECT_REASONS) {
      const [title, subtitle, tone] = expected[reason];
      expect(deniedDisplay(reason, 'Ana')).toMatchObject({
        title,
        subtitle,
        tone,
      });
    }
  });

  it('uses a fallback title when a rejection has no known student', () => {
    expect(deniedDisplay('NOT_IN_SCHEDULE', null).title).toBe('Estudiante');
  });

  it('announces an unrecognised fingerprint like an unknown slot', () => {
    expect(unknownDisplay()).toMatchObject({
      title: 'Huella no reconocida',
      subtitle: 'Intente de nuevo',
      tone: 'error',
      color: 'red',
    });
  });

  it('keeps the deprecated aliases equal to the contract fields', () => {
    for (const d of allDisplays()) {
      expect(d.line1).toBe(d.title);
      expect(d.line2).toBe(d.subtitle);
    }
  });

  it('fits every message within the default limits', () => {
    for (const d of allDisplays()) {
      expect(validateDisplayMessage(d)).toMatchObject({ ok: true });
    }
    for (const m of [SYSTEM_ERROR_MESSAGE, ALARM_MESSAGE]) {
      expect(validateDisplayMessage(m)).toMatchObject({ ok: true });
    }
  });

  it('defines the alarm as a warning and the clear message as empty', () => {
    expect(ALARM_MESSAGE).toEqual({
      title: 'Tiempo cumplido',
      subtitle: 'Registre su salida',
      tone: 'warning',
    });
    expect(CLEAR_MESSAGE).toEqual({ title: '', subtitle: '', tone: 'info' });
  });
});
