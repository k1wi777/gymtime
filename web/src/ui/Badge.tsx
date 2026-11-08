import type { ReactNode } from 'react';
import styles from './Badge.module.css';

/**
 * `soft` and `mint` are the two lighter greens of the administrator boards
 * (consent and state; active period and counts).
 */
export type BadgeTone =
  'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'soft' | 'mint';

export function Badge({
  tone = 'neutral',
  size = 'md',
  children,
}: {
  tone?: BadgeTone;
  /** `sm`: origin tags next to a time; `xs`: «Usted» next to a name. */
  size?: 'md' | 'sm' | 'xs';
  children: ReactNode;
}) {
  const sized = size === 'md' ? '' : ` ${styles[size]}`;
  return (
    <span className={`${styles.badge} ${styles[tone]}${sized}`}>
      {children}
    </span>
  );
}
