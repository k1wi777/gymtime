'use client';

/**
 * The ONLY module that imports Recharts (a test enforces it). It is loaded
 * lazily by `BarChart.tsx`, so no other screen pays for the library.
 */
import {
  Bar,
  BarChart as RechartsBarChart,
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
const LABEL_ALL_UP_TO = 24;
const LABEL_SHARE = 0.25;

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
  color = 'var(--chart-1)',
}: BarChartProps) {
  const rows = [...data];
  const max = Math.max(1, ...rows.map((d) => d.value));
  const showValue = (d: BarDatum) =>
    d.value > 0 &&
    (rows.length <= LABEL_ALL_UP_TO || d.peak || d.value >= max * LABEL_SHARE);

  /** Value above each bar; the peak one takes its own darker amber. */
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
        {formatInt(datum.value)}
      </text>
    );
  };

  const shape = (props: BarShapeProps) => {
    const datum = rows[props.index];
    return (
      <Rectangle
        {...props}
        fill={datum?.peak ? 'var(--accent)' : color}
        className={styles.bar}
      />
    );
  };

  const chart = (
    <RechartsBarChart
      data={rows}
      width={width}
      height={width === undefined ? undefined : height}
      margin={{ top: 22, right: 4, bottom: 0, left: 4 }}
      accessibilityLayer
    >
      <XAxis
        dataKey="label"
        tickLine={false}
        axisLine={{ stroke: 'var(--chart-axis)' }}
        tick={{ fontSize: 11, fill: 'var(--muted)' }}
        interval="preserveStartEnd"
      />
      {/* No visible axis (the values sit over the bars); it only fixes the scale. */}
      <YAxis hide domain={[0, 'dataMax']} />
      <Tooltip
        content={<TooltipBody />}
        cursor={{ fill: 'var(--primary-light)', opacity: 0.6 }}
        isAnimationActive={false}
      />
      <Bar
        dataKey="value"
        shape={shape}
        radius={[6, 6, 0, 0]}
        maxBarSize={38}
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
