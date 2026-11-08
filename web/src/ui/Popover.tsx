'use client';

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
 * trigger. Positioning is plain CSS: the panel hangs from the field.
 */
export function Popover({ label, trigger, children }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // The button that opened the panel (a pair of fields shares one panel).
  const opener = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) opener.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  // A panel that would leave the window hangs from the right edge of the field.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!open || !element) return;
    element.classList.remove(styles.right as string);
    if (element.getBoundingClientRect().right > window.innerWidth) {
      element.classList.add(styles.right as string);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const target =
      panel.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      panel.current;
    target?.focus();
  }, [open]);

  return (
    <div
      ref={root}
      className={styles.root}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (open && next && !root.current?.contains(next)) setOpen(false);
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
      {open && (
        <div
          ref={panel}
          id={panelId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={styles.panel}
        >
          {children(() => close(true))}
        </div>
      )}
    </div>
  );
}
