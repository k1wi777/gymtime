'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import styles from './ConfirmDialog.module.css';

interface Props {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the confirm button red. */
  tone?: 'primary' | 'danger';
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation on the native `<dialog>`: the browser traps focus, closes on
 * Escape (reported through `onCancel`) and restores focus on close.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'primary',
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      {open && (
        <div className="stack">
          <h2 id="confirm-title">{title}</h2>
          {children && <div>{children}</div>}
          <div className={styles.actions}>
            <button
              type="button"
              className="btn"
              onClick={onCancel}
              disabled={busy}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
              onClick={onConfirm}
              disabled={busy || confirmDisabled}
            >
              {busy ? 'Un momento…' : confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
