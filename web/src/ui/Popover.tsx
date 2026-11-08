'use client';

import { createPortal } from 'react-dom';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { computePlacement } from '@/lib/popover-position';
import styles from './Popover.module.css';

export interface PopoverTriggerProps {
  'aria-haspopup': 'dialog';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

interface Props {
  /** Accessible name of the panel. */
  label: string;
  /** The button that opens the panel: spread `triggerProps` on it. */
  trigger: (triggerProps: PopoverTriggerProps, open: boolean) => ReactNode;
  /** The panel; `close` shuts it and returns the focus to the trigger. */
  children: (close: () => void) => ReactNode;
}

/**
 * A panel under its trigger. Escape, a click outside or the focus leaving it
 * close it; closing with Escape (or by choosing) returns the focus to the
 * trigger. The panel is portalled to `body` with fixed position, so no
 * ancestor `overflow` clips it, and placed by `computePlacement`: below the
 * field if it fits, above otherwise, aligned to the side with room, and with
 * an inner scroll (`max-height`) when it fits nowhere.
 */
export function Popover({ label, trigger, children }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // The button that opened the panel (a pair of fields shares one panel).
  const opener = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const inside = (node: Node) =>
    !!root.current?.contains(node) || !!panel.current?.contains(node);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) opener.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!inside(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const place = useCallback(() => {
    const element = panel.current;
    const anchor = root.current;
    if (!element || !anchor) return;
    // Measuring at natural size resets inner scrolls: save and restore them.
    const scrolls: [HTMLElement, number][] = [];
    for (const node of [
      element,
      ...element.querySelectorAll<HTMLElement>('*'),
    ]) {
      if (node.scrollTop > 0) scrolls.push([node, node.scrollTop]);
    }
    element.style.maxHeight = '';
    element.style.maxWidth = '';
    const rect = anchor.getBoundingClientRect();
    element.style.minWidth = `${Math.round(rect.width)}px`;
    const placement = computePlacement({
      anchor: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      },
      panel: { width: element.offsetWidth, height: element.offsetHeight },
      viewport: {
        width: document.documentElement.clientWidth,
        height: window.innerHeight,
      },
    });
    element.style.top = `${Math.round(placement.top)}px`;
    element.style.left = `${Math.round(placement.left)}px`;
    element.style.maxWidth = `${placement.maxWidth}px`;
    element.style.maxHeight =
      placement.maxHeight === undefined ? '' : `${placement.maxHeight}px`;
    element.dataset.side = placement.side;
    element.style.visibility = 'visible';
    for (const [node, top] of scrolls) node.scrollTop = top;
  }, []);

  // Placed before paint (the panel is hidden until then); re-placed while open
  // when the window, any scrolled container or the panel itself changes size.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    let frame = 0;
    const schedule = (event?: Event | ResizeObserverEntry[]) => {
      // Scrolls inside the panel do not move the anchor: ignore them.
      const target = event instanceof Event ? event.target : null;
      if (target instanceof Node && panel.current?.contains(target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(schedule);
    if (panel.current) observer?.observe(panel.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      observer?.disconnect();
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const target =
      panel.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel.current;
    target?.focus({ preventScroll: true });
  }, [open]);

  return (
    <div
      ref={root}
      className={styles.root}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (open && next && !inside(next)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          close(true);
        }
      }}
    >
      {trigger(
        {
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-controls': open ? panelId : undefined,
          onClick: (event) => {
            opener.current = event.currentTarget;
            setOpen((current) => !current);
          },
        },
        open,
      )}
      {open &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="dialog"
            aria-label={label}
            tabIndex={-1}
            className={styles.panel}
          >
            {children(() => close(true))}
          </div>,
          document.body,
        )}
    </div>
  );
}
