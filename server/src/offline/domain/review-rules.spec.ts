import { OFFLINE_REVIEW_REASONS } from '@gymtime/shared';
import { allowedActions, canApprove, canCorrect } from './review-rules.js';

describe('review rules (R15)', () => {
  it('always allows discarding', () => {
    for (const reason of OFFLINE_REVIEW_REASONS) {
      expect(allowedActions('entry', reason)).toContain('descartar');
      expect(allowedActions('exit', reason)).toContain('descartar');
    }
  });

  it.each([
    ['EXIT_WITHOUT_ENTRY', 'exit'],
    ['DUPLICATE_ENTRY', 'entry'],
    ['UNKNOWN_SLOT', 'entry'],
    ['UNKNOWN_SNAPSHOT', 'exit'],
  ] as const)('%s cannot be approved', (reason, type) => {
    expect(canApprove(type, reason)).toBe(false);
  });

  it('cannot correct what has no student or no roster', () => {
    expect(canCorrect('entry', 'UNKNOWN_SLOT')).toBe(false);
    expect(canCorrect('entry', 'UNKNOWN_SNAPSHOT')).toBe(false);
    expect(canCorrect('exit', 'EXIT_WITHOUT_ENTRY')).toBe(true);
  });

  it('offers approving an exit only where the exit is the problem', () => {
    expect(allowedActions('exit', 'SESSION_ALREADY_CLOSED')).toEqual([
      'aprobar',
      'corregir',
      'descartar',
    ]);
    expect(allowedActions('entry', 'OUTSIDE_WINDOW')).toEqual([
      'aprobar',
      'corregir',
      'descartar',
    ]);
    expect(allowedActions('entry', 'DUPLICATE_ENTRY')).toEqual([
      'corregir',
      'descartar',
    ]);
  });

  it('offers nothing for an event that is not pending', () => {
    expect(allowedActions('entry', null)).toEqual([]);
  });
});
