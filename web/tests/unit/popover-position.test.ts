import { describe, expect, it } from 'vitest';
import { computePlacement } from '@/lib/popover-position';

const viewport = { width: 1000, height: 700 };
const panel = { width: 400, height: 300 };
const field = (top: number, left = 100) => ({
  top,
  left,
  width: 200,
  height: 40,
});

describe('computePlacement', () => {
  it('hangs below when it fits', () => {
    const p = computePlacement({ anchor: field(100), panel, viewport });
    expect(p).toMatchObject({
      side: 'below',
      top: 146,
      left: 100,
      align: 'start',
    });
    expect(p.maxHeight).toBeUndefined();
  });
  it('opens above near the bottom edge', () => {
    const p = computePlacement({ anchor: field(600), panel, viewport });
    expect(p).toMatchObject({ side: 'above', top: 294 });
    expect(p.maxHeight).toBeUndefined();
  });
  it('limits the height on the roomier side when it fits nowhere', () => {
    const p = computePlacement({
      anchor: field(200),
      panel: { width: 400, height: 900 },
      viewport,
    });
    expect(p.side).toBe('below');
    expect(p.maxHeight).toBe(700 - 240 - 6 - 8);
    expect(p.top + (p.maxHeight ?? 0)).toBeLessThanOrEqual(700 - 8);
    const up = computePlacement({
      anchor: field(500),
      panel: { width: 400, height: 900 },
      viewport,
    });
    expect(up.side).toBe('above');
    expect(up.maxHeight).toBe(500 - 6 - 8);
    expect(up.top).toBe(8);
  });
  it('aligns to the right edge of the field near the right border', () => {
    const p = computePlacement({ anchor: field(100, 750), panel, viewport });
    expect(p).toMatchObject({ align: 'end', left: 550 });
  });
  it('shrinks to a narrow viewport and stays inside', () => {
    const p = computePlacement({
      anchor: field(100, 20),
      panel,
      viewport: { width: 320, height: 700 },
    });
    expect(p.maxWidth).toBe(304);
    expect(p.left).toBe(8);
  });
  it('clamps an anchor wider than the viewport', () => {
    const p = computePlacement({
      anchor: { top: 10, left: -50, width: 2000, height: 40 },
      panel,
      viewport,
    });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 400).toBeLessThanOrEqual(992);
  });
});
