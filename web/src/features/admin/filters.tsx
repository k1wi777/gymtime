'use client';

import { DateRangePicker } from '@/ui/DatePicker';
import type { AuditItem } from '@/api/types';
import styles from './Admin.module.css';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `from`/`to` days (Bogota) as the instants the API filters on. */
export function dayRange(
  from: string,
  to: string,
): { from?: string; to?: string } {
  return {
    ...(DAY.test(from) ? { from: `${from}T00:00:00-05:00` } : {}),
    ...(DAY.test(to) ? { to: `${to}T23:59:59.999-05:00` } : {}),
  };
}

export function DateRange({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  const bad = (value: string) => value !== '' && !DAY.test(value);
  return (
    <DateRangePicker
      className={styles.dateRange}
      from={from}
      to={to}
      onChange={(range) => {
        onFrom(range.from);
        onTo(range.to);
      }}
      fromError={bad(from) ? 'Use AAAA-MM-DD.' : undefined}
      toError={bad(to) ? 'Use AAAA-MM-DD.' : undefined}
      shortcuts={['today', 'last7', 'clear']}
    />
  );
}

/** Detail of an audit event as key/value tags of plain text (never HTML). */
export function Detail({ detail }: { detail: AuditItem['detail'] }) {
  if (!detail || Object.keys(detail).length === 0) {
    return <span className={styles.none}>—</span>;
  }
  return (
    <dl className={styles.tags}>
      {Object.entries(detail).map(([key, value]) => (
        <div key={key} className={styles.tag}>
          <dt>{key}</dt>
          <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
