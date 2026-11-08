/** One bar: the label is the x axis text (`07:00`, `Lun`), `tooltip` the full sentence. */
export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** One of the busiest buckets: drawn with the amber pattern and the "Pico" label. */
  peak: boolean;
  tooltip: string;
}

export interface BarChartProps {
  data: readonly BarDatum[];
  /** Summary read by assistive technology (the chart itself is an image). */
  ariaLabel: string;
  /** Fixed size for tests; in the browser the chart fills its container. */
  width?: number;
  height?: number;
  /** Fill of the regular bars (a color per chart); the peak is the accent. */
  color?: string;
}

export const CHART_HEIGHT = 214;
