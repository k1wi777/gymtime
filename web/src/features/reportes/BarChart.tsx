'use client';

import dynamic from 'next/dynamic';
import { useId, useState } from 'react';
import { Spinner } from '@/ui/Spinner';
import type { BarDatum } from './charts/chart-types';
import { formatInt } from './format';
import styles from './Reportes.module.css';

/**
 * Recharts is heavy (~100 kB gzip): it is imported only here and only in the
 * browser, so no other route downloads it.
 */
const RechartsBar = dynamic(() => import('./charts/RechartsBar'), {
  ssr: false,
  loading: () => <Spinner label="Cargando gráfica…" />,
});

interface Props {
  title: string;
  /** Range and filters in force, below the title. */
  subtitle: string;
  data: readonly BarDatum[];
  ariaLabel: string;
  /** Header of the value column of the equivalent table. */
  valueHeader: string;
  labelHeader: string;
  /** Fixed size, tests only. */
  width?: number;
}

/** A titled card: bar chart without an external legend and its table equivalent. */
export function BarChart({
  title,
  subtitle,
  data,
  ariaLabel,
  valueHeader,
  labelHeader,
  width,
}: Props) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  return (
    <section className={styles.card} aria-label={title}>
      <header className={styles.cardHeader}>
        <div>
          <h3>{title}</h3>
          <p className="muted">{subtitle}</p>
        </div>
        <button
          type="button"
          className="btn"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((value) => !value)}
        >
          {showTable ? 'Ocultar la tabla' : 'Ver datos como tabla'}
        </button>
      </header>
      <RechartsBar
        data={data}
        ariaLabel={ariaLabel}
        {...(width === undefined ? {} : { width })}
      />
      {/* Always in the DOM; the stylesheet shows it by default on narrow screens. */}
      <div
        id={tableId}
        className={styles.equivalent}
        data-open={showTable ? 'true' : undefined}
      >
        <table className={styles.plainTable}>
          <caption className="visually-hidden">{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">{labelHeader}</th>
              <th scope="col">{valueHeader}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.key}>
                <th scope="row">{d.label}</th>
                <td>
                  {formatInt(d.value)}
                  {d.peak ? ' (pico)' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
