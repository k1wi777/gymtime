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
  /** Fill of the regular bars: a different color for each chart. */
  color?: string;
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
  color = 'var(--chart-1)',
  width,
}: Props) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  return (
    <section className={`card ${styles.chartCard}`} aria-label={title}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>{title}</h2>
          <p className={styles.cardSub}>{subtitle}</p>
        </div>
        <button
          type="button"
          className="btn btn-s"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((value) => !value)}
        >
          {showTable ? 'Ocultar tabla' : 'Ver tabla'}
        </button>
      </header>
      <RechartsBar
        data={data}
        ariaLabel={ariaLabel}
        color={color}
        {...(width === undefined ? {} : { width })}
      />
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span
            aria-hidden="true"
            className={styles.swatch}
            style={{ background: color }}
          />
          {valueHeader}
        </span>
        <span className={styles.legendItem}>
          <span
            aria-hidden="true"
            className={styles.swatch}
            style={{ background: 'var(--accent)' }}
          />
          Pico
        </span>
      </div>
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
