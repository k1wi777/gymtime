import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

interface Props {
  /** Small uppercase line above the title. */
  eyebrow: string;
  title: string;
  /** Paragraph under the title. */
  lead?: ReactNode;
  /** Pill or control aligned to the right of the title. */
  aside?: ReactNode;
  /** Extra content under the title (before the lead). */
  children?: ReactNode;
}

/** Header shared by the assistant screens: eyebrow, title, lead and aside. */
export function PageHeader({ eyebrow, title, lead, aside, children }: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <div>
          <div className={styles.eyebrow}>{eyebrow}</div>
          <h1 className={styles.title}>{title}</h1>
          {children}
          {lead && <p className={styles.lead}>{lead}</p>}
        </div>
        {aside}
      </div>
    </header>
  );
}
