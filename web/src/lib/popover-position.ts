/**
 * Pure placement of a floating panel next to an anchor so that it stays inside
 * the viewport (the way a native select does). No DOM access: rects in, a
 * fixed-position box out.
 */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PlacementInput {
  anchor: Box;
  /** Natural (unconstrained) size of the panel. */
  panel: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Space between the anchor and the panel. */
  gap?: number;
  /** Minimum space kept to the edges of the viewport. */
  margin?: number;
}

export interface Placement {
  top: number;
  left: number;
  /** Height limit when the panel does not fit; it then scrolls inside. */
  maxHeight: number | undefined;
  /** Width limit on viewports narrower than the panel. */
  maxWidth: number;
  side: 'below' | 'above';
  align: 'start' | 'end';
}

export function computePlacement({
  anchor,
  panel,
  viewport,
  gap = 6,
  margin = 8,
}: PlacementInput): Placement {
  const below = viewport.height - (anchor.top + anchor.height) - gap - margin;
  const above = anchor.top - gap - margin;
  const side: Placement['side'] =
    panel.height <= below || (panel.height > above && below >= above)
      ? 'below'
      : 'above';
  const room = Math.max(side === 'below' ? below : above, 0);
  const maxHeight = panel.height > room ? room : undefined;
  const height = Math.min(panel.height, room);
  const top =
    side === 'below'
      ? anchor.top + anchor.height + gap
      : anchor.top - gap - height;

  const maxWidth = Math.max(viewport.width - 2 * margin, 0);
  const width = Math.min(panel.width, maxWidth);
  let align: Placement['align'] = 'start';
  let left = anchor.left;
  if (left + width > viewport.width - margin) {
    align = 'end';
    left = anchor.left + anchor.width - width;
  }
  left = Math.min(Math.max(left, margin), viewport.width - margin - width);
  return { top, left, maxHeight, maxWidth, side, align };
}
