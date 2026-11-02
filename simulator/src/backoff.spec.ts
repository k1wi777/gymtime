import { Backoff, Dedupe } from './backoff.js';

describe('Backoff', () => {
  it('doubles from 1 s up to the 30 s cap and resets', () => {
    const backoff = new Backoff();
    const delays = Array.from({ length: 8 }, () => backoff.next());
    expect(delays).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
    backoff.reset();
    expect(backoff.next()).toBe(1000);
  });
});

describe('Dedupe', () => {
  it('remembers ids and evicts the oldest beyond capacity', () => {
    const dedupe = new Dedupe(2);
    dedupe.add('a');
    dedupe.add('b');
    dedupe.add('c');
    expect(dedupe.has('a')).toBe(false);
    expect(dedupe.has('b')).toBe(true);
    expect(dedupe.has('c')).toBe(true);
  });
});
