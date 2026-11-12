'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

interface ModalContextValue {
  /** The fixed footer: forms portal their buttons into it. */
  footer: HTMLElement | null;
}

const ModalContext = createContext<ModalContextValue | null>(null);

/** The footer element of the enclosing modal, or null outside a modal. */
export const useModalFooter = (): HTMLElement | null =>
  useContext(ModalContext)?.footer ?? null;

/** True inside a modal: forms drop their own card and title there. */
export const useInModal = (): boolean => useContext(ModalContext) !== null;

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const focusablesIn = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) =>
      !node.closest('[inert], [hidden]') &&
      !(node instanceof HTMLInputElement && node.type === 'hidden'),
  );

// Several modals can stack: the page scrolls again when the last one closes.
let openModals = 0;
let savedOverflow = '';
let savedPadding = '';

function lockScroll() {
  if (openModals++ > 0) return;
  const body = document.body;
  savedOverflow = body.style.overflow;
  savedPadding = body.style.paddingRight;
  const bar = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (bar > 0) body.style.paddingRight = `${bar}px`;
}

function unlockScroll() {
  if (--openModals > 0) return;
  document.body.style.overflow = savedOverflow;
  document.body.style.paddingRight = savedPadding;
}

interface Props {
  open: boolean;
  title: string;
  /** A request to close (Escape, backdrop, X); the parent decides. */
  onClose: () => void;
  /** Saving: nothing closes the modal meanwhile. */
  busy?: boolean;
  size?: 'md' | 'lg' | 'w560' | 'w600';
  /** `side`: a sheet anchored to the right edge (the student's card). */
  placement?: 'center' | 'side';
  /** Line under the title (for example the schedule the modal is about). */
  description?: string;
  /** Accessible name when the visible title is only a caption. */
  ariaLabel?: string;
  children: ReactNode;
}

/**
 * An accessible dialog on a `div` in a portal (not the native `<dialog>`: its
 * top layer would hide the date and schedule popovers, which are portalled
 * with a lower z-index). It traps Tab, returns the focus to the button that
 * opened it, locks the page scroll and makes the rest of the page inert.
 */
export function Modal(props: Props) {
  return props.open ? <ModalBody {...props} /> : null;
}

function ModalBody({
  title,
  onClose,
  busy = false,
  size = 'md',
  placement = 'center',
  description,
  ariaLabel,
  children,
}: Props) {
  const titleId = useId();
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const pressedOnBackdrop = useRef(false);
  // Latest values for the one-time effect below.
  const opener = useRef<HTMLElement | null>(null);
  if (opener.current === null && typeof document !== 'undefined') {
    opener.current = document.activeElement as HTMLElement | null;
  }

  useEffect(() => {
    lockScroll();
    const hidden: HTMLElement[] = [];
    for (const node of document.body.children) {
      if (node !== backdrop.current && node instanceof HTMLElement) {
        if (node.tagName !== 'SCRIPT' && !node.hasAttribute('inert')) {
          node.setAttribute('inert', '');
          hidden.push(node);
        }
      }
    }
    const target =
      panel.current?.querySelector<HTMLElement>('[data-autofocus]') ??
      (body.current ? focusablesIn(body.current)[0] : undefined) ??
      panel.current;
    target?.focus({ preventScroll: true });
    const returnTo = opener.current;
    return () => {
      for (const node of hidden) node.removeAttribute('inert');
      unlockScroll();
      if (returnTo?.isConnected) returnTo.focus();
      else document.querySelector<HTMLElement>('h1')?.focus();
    };
  }, []);

  const request = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const root = panel.current;
    if (!root || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    // Keys from a popover portal or a nested native dialog are theirs.
    if (!root.contains(target) || target.closest('dialog')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      request();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusablesIn(root);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (target === first || target === root)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && target === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      ref={backdrop}
      className={`${styles.backdrop} ${placement === 'side' ? styles.sideBackdrop : ''}`}
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === backdrop.current;
      }}
      onPointerUp={(event) => {
        // Both ends on the backdrop: a text selection dragged out is not a close.
        if (pressedOnBackdrop.current && event.target === backdrop.current) {
          request();
        }
        pressedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={`${styles.panel} ${size === 'md' ? '' : styles[size]} ${placement === 'side' ? styles.side : ''}`}
        onKeyDown={onKeyDown}
      >
        <header className={styles.head}>
          <div className={styles.heading}>
            <h2 id={titleId} className={styles.title}>
              {title}
            </h2>
            {description && <p className={styles.description}>{description}</p>}
          </div>
          <button
            type="button"
            className={styles.close}
            aria-label="Cerrar"
            disabled={busy}
            onClick={request}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div ref={body} className={styles.body}>
          <ModalContext.Provider value={{ footer }}>
            {children}
          </ModalContext.Provider>
        </div>
        <footer ref={setFooter} className={styles.footer} />
      </div>
    </div>,
    document.body,
  );
}
