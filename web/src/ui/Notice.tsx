import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import styles from './Notice.module.css';

export type NoticeKind = 'info' | 'success' | 'warning' | 'error';

/** Base display time (ms) of the notices that close themselves; errors never do. */
export const NOTICE_DURATIONS = {
  success: 5_000,
  info: 8_000,
  warning: 12_000,
} as const;
/** Text beyond this many characters adds `NOTICE_MS_PER_CHAR` each. */
export const NOTICE_LONG_TEXT = 80;
export const NOTICE_MS_PER_CHAR = 40;
export const NOTICE_MAX_MS = 20_000;

interface Props {
  kind?: NoticeKind;
  title?: string;
  children?: ReactNode;
  /**
   * Closes the notice (the parent owns its visibility). Without it the notice
   * never closes by itself.
   */
  onDismiss?: () => void;
  /** Extra controls, for example a retry button. */
  actions?: ReactNode;
  /**
   * Auto-close: absent = by kind (only with `onDismiss`, never for errors);
   * `false` = off (persistent state); a number = own duration in ms.
   */
  autoClose?: boolean | number;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (typeof node === 'object' && 'props' in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return '';
}

/** Display time in ms, or `null` when this notice must not close by itself. */
export function noticeDuration(
  kind: NoticeKind,
  autoClose: boolean | number | undefined,
  hasDismiss: boolean,
  length: number,
): number | null {
  if (kind === 'error' || !hasDismiss || autoClose === false) return null;
  if (typeof autoClose === 'number') return autoClose;
  const extra = Math.max(0, length - NOTICE_LONG_TEXT) * NOTICE_MS_PER_CHAR;
  return Math.min(NOTICE_DURATIONS[kind] + extra, NOTICE_MAX_MS);
}

/** Errors are announced at once (`alert`); the rest politely (`status`). */
export function Notice({
  kind = 'info',
  title,
  children,
  onDismiss,
  actions,
  autoClose,
}: Props) {
  const contentKey = `${kind}|${title ?? ''}|${textOf(children)}`;
  const duration = noticeDuration(
    kind,
    autoClose,
    Boolean(onDismiss),
    (title ?? '').length + textOf(children).length,
  );
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const remaining = useRef(0);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const run = useCallback(
    (ms: number) => {
      stop();
      remaining.current = ms;
      startedAt.current = Date.now();
      timer.current = setTimeout(() => dismiss.current?.(), ms);
    },
    [stop],
  );

  // A new message (or duration) restarts the countdown (R10).
  useEffect(() => {
    setPaused(false);
    if (duration === null) return undefined;
    run(duration);
    return stop;
  }, [contentKey, duration, run, stop]);

  const pause = () => {
    if (duration === null || timer.current === null) return;
    remaining.current = Math.max(
      0,
      remaining.current - (Date.now() - startedAt.current),
    );
    stop();
    setPaused(true);
  };
  const resume = () => {
    if (duration === null || timer.current !== null) return;
    setPaused(false);
    run(remaining.current);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) resume();
  };

  return (
    <div
      className={`${styles.notice} ${styles[kind]}`}
      role={kind === 'error' ? 'alert' : 'status'}
      onMouseEnter={pause}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) resume();
      }}
      onFocus={pause}
      onBlur={onBlur}
    >
      <div className={styles.body}>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          className={styles.close}
          onClick={() => {
            stop();
            onDismiss();
          }}
          aria-label="Cerrar aviso"
        >
          ×
        </button>
      )}
      {duration !== null && (
        <span
          key={contentKey}
          aria-hidden="true"
          data-testid="notice-progress"
          className={styles.progress}
          style={{
            animationDuration: `${duration}ms`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      )}
    </div>
  );
}
