import type { ReactNode } from 'react';
import styles from './Admin.module.css';

const WIDTHS = {
  720: styles.wide720,
  900: styles.wide900,
  940: styles.wide940,
} as const;

/** Card with a table of the administrator boards and an optional footer bar. */
export function BoardCard({
  label,
  minWidth,
  tight = false,
  children,
  footer,
}: {
  label: string;
  minWidth: keyof typeof WIDTHS;
  /** Narrower cell sides, for tables that share the row with a side card. */
  tight?: boolean;
  /** The `<caption>`, `<thead>` and `<tbody>` of the table. */
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className={`card ${styles.tableCard}`} aria-label={label}>
      <div className={styles.scroll}>
        <table
          className={`${styles.board} ${WIDTHS[minWidth]} ${tight ? styles.tight : ''}`}
        >
          {children}
        </table>
      </div>
      {footer}
    </section>
  );
}
