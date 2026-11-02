import { expect, it } from 'vitest';
import { formatTable } from './output.js';

it('aligns columns to the widest cell', () => {
  expect(
    formatTable(
      ['A', 'BB'],
      [
        ['xxx', 'y'],
        ['z', ''],
      ],
    ),
  ).toBe(['A    BB', 'xxx  y', 'z'].join('\n'));
});
