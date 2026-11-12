import { completeLegacyDisplay } from './legacy-display.js';

describe('completeLegacyDisplay', () => {
  it('fills title, subtitle and tone from an old line1/line2 order', () => {
    expect(
      completeLegacyDisplay({ line1: 'Hola', line2: 'Ana', durationSec: 4 }),
    ).toEqual({
      title: 'Hola',
      subtitle: 'Ana',
      tone: 'info',
      line1: 'Hola',
      line2: 'Ana',
      color: 'white',
      durationSec: 4,
    });
  });

  it('leaves current payloads untouched', () => {
    const payload = { title: 'Hola', subtitle: '', tone: 'error' };
    expect(completeLegacyDisplay(payload)).toBe(payload);
  });
});
