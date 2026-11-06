import type { ReactNode } from 'react';
import styles from './Notice.module.css';

export type NoticeKind = 'info' | 'success' | 'warning' | 'error';

interface Props {
  kind?: NoticeKind;
  title?: string;
  children?: ReactNode;
  onDismiss?: () => void;
  /** Extra controls, for example a retry button. */
  actions?: ReactNode;
}

/** Errors are announced at once (`alert`); the rest politely (`status`). */
export function Notice({
  kind = 'info',
  title,
  children,
  onDismiss,
  actions,
}: Props) {
  return (
    <div
      className={`${styles.notice} ${styles[kind]}`}
      role={kind === 'error' ? 'alert' : 'status'}
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
          onClick={onDismiss}
          aria-label="Cerrar aviso"
        >
          ×
        </button>
      )}
    </div>
  );
}
