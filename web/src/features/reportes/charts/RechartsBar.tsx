'use client';

/**
 * The ONLY module that imports Recharts (a test enforces it). It is loaded
 * lazily by `BarChart.tsx`, so no other screen pays for the library.
 */
import {
  Bar,
  BarChart as RechartsBarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from 'recharts';
import { formatInt } from '../format';
import { CHART_HEIGHT, type BarChartProps, type BarDatum } from './chart-types';
import styles from './Chart.module.css';

/** With more bars than this, only the big ones and the peaks get a number. */
const LABEL_ALL_UP_TO = 12;
const LABEL_SHARE = 0.25;

const GRADIENT = 'gt-bar-gradient';
const PATTERN = 'gt-peak-pattern';

interface LabelProps {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  index?: number;
}

function TooltipBody({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: BarDatum }>;
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  return <output className={styles.tooltip}>{datum.tooltip}</output>;
}

export default function RechartsBar({
  data,
  ariaLabel,
  width,
  height = CHART_HEIGHT,
}: BarChartProps) {
  const rows = [...data];
  const max = Math.max(1, ...rows.map((d) => d.value));
  const showValue = (d: BarDatum) =>
    rows.length <= LABEL_ALL_UP_TO || d.peak || d.value >= max * LABEL_SHARE;

  /** Value above each bar; peaks also say "Pico" (never only color). */
  const renderLabel = ({ x, y, width: w, index }: LabelProps) => {
    const datum = index === undefined ? undefined : rows[index];
    if (!datum || !showValue(datum)) return null;
    const cx = Number(x) + Number(w) / 2;
    return (
      <text
        x={cx}
        y={Number(y) - 6}
        textAnchor="middle"
        className={datum.peak ? styles.peakLabel : styles.valueLabel}
      >
        {datum.peak ? <tspan>Pico </tspan> : null}
        {formatInt(datum.value)}
      </text>
    );
  };

  const shape = (props: BarShapeProps) => {
    const datum = rows[props.index];
    return (
      <Rectangle
        {...props}
        fill={datum?.peak ? `url(#${PATTERN})` : `url(#${GRADIENT})`}
        stroke={datum?.peak ? 'var(--peak)' : 'var(--primary)'}
        strokeWidth={datum?.peak ? 2 : 0}
        className={styles.bar}
      />
    );
  };

  const chart = (
    <RechartsBarChart
      data={rows}
      width={width}
      height={width === undefined ? undefined : height}
      margin={{ top: 24, right: 24, bottom: 4, left: 0 }}
      accessibilityLayer
    >
      <defs>
        <linearGradient id={GRADIENT} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary-mid)" />
          <stop offset="100%" stopColor="var(--primary)" />
        </linearGradient>
        <pattern
          id={PATTERN}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" fill="var(--surface)" />
          <rect width="4" height="8" fill="var(--peak)" />
        </pattern>
      </defs>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={{ stroke: 'var(--border)' }}
        tick={{ fontSize: 12, fill: 'var(--muted)' }}
        interval="preserveStartEnd"
      />
      <YAxis
        allowDecimals={false}
        tickLine={false}
        axisLine={false}
        width={36}
        tick={{ fontSize: 12, fill: 'var(--muted)' }}
        tickFormatter={(value: number) => formatInt(value)}
      />
      <Tooltip
        content={<TooltipBody />}
        cursor={{ fill: 'var(--primary-light)', opacity: 0.6 }}
        isAnimationActive={false}
      />
      <Bar
        dataKey="value"
        shape={shape}
        radius={[4, 4, 0, 0]}
        isAnimationActive={false}
        label={renderLabel}
      />
    </RechartsBarChart>
  );

  return (
    // A chart is an SVG tree, not an <img>: the role gives it one text summary.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <div className={styles.chart} role="img" aria-label={ariaLabel}>
      {width === undefined ? (
        <ResponsiveContainer width="100%" height={height}>
          {chart}
        </ResponsiveContainer>
      ) : (
        chart
      )}
    </div>
  );
}
