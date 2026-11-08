'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/ui/icons';
import styles from './RowMenu.module.css';

export interface RowMenuItem {
  key: string;
  label: string;
  /** Accessible name when the label alone is ambiguous in a table. */
  ariaLabel?: string;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  /** Name of the «Más» button, for example «Más acciones de Ana». */
  label: string;
  items: readonly RowMenuItem[];
}

/**
 * «Más» menu of a table row. The list is drawn outside the table (a portal,
 * fixed to the button) so the scrolling card never clips it. It opens with
 * click or Enter, moves with the arrows and closes with Escape, with a click
 * outside, on scroll or when an action is chosen.
 */
export function RowMenu({ label, items }: Props) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = () => setAt(null);
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !menu.current?.contains(target) &&
        !button.current?.contains(target)
      ) {
        close();
      }
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setAt(null);
      return;
    }
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setAt({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const entries = [
      ...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      entries[(to + entries.length) % entries.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(entries.length - 1);
  };

  if (items.length === 0) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        className="btn btn-s"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={toggle}
      >
        Más
        <Icon name="chevronDown" size={14} strokeWidth={2} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            role="menu"
            tabIndex={-1}
            className={styles.menu}
            style={{ top: at.top, right: at.right }}
            onKeyDown={onMenuKey}
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                aria-label={item.ariaLabel}
                className={
                  item.danger ? `${styles.item} ${styles.danger}` : styles.item
                }
                onClick={() => {
                  setAt(null);
                  // The dialog opened by the action gives the focus back here.
                  button.current?.focus();
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
