import type { ReactNode } from 'react';
import { Icon } from '@/ui/icons';
import styles from './PageHeader.module.css';

interface Props {
  /** Small uppercase line above the title (ignored when `crumb` is given). */
  eyebrow?: string;
  /**
   * Administrator screens: current page of the «Administración › Página»
   * route, shown instead of the uppercase eyebrow.
   */
  crumb?: string;
  title: string;
  /** Paragraph under the title. */
  lead?: ReactNode;
  /** Pill or control aligned to the right of the title. */
  aside?: ReactNode;
  /** Extra content under the title (before the lead). */
  children?: ReactNode;
}

/** Header shared by the screens: eyebrow or route, title, lead and aside. */
export function PageHeader({
  eyebrow,
  crumb,
  title,
  lead,
  aside,
  children,
}: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.row}>
        <div className={crumb ? styles.crumbBox : undefined}>
          {crumb ? (
            <nav aria-label="Ruta" className={styles.crumb}>
              Administración
              <Icon name="chevron" size={12} />
              <span className={styles.crumbHere}>{crumb}</span>
            </nav>
          ) : (
            <div className={styles.eyebrow}>{eyebrow}</div>
          )}
          <h1 className={crumb ? styles.titleCrumb : styles.title}>{title}</h1>
          {children}
          {lead && (
            <p className={crumb ? styles.leadCrumb : styles.lead}>{lead}</p>
          )}
        </div>
        {aside}
      </div>
    </header>
  );
}
