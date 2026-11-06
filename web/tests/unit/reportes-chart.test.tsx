import { render, screen } from '@testing-library/react';
import { BarChart } from '@/features/reportes/BarChart';
import type { BarDatum } from '@/features/reportes/charts/chart-types';
import RechartsBar from '@/features/reportes/charts/RechartsBar';

// jsdom has no layout: the chart gets a fixed size (the real one fills its box).
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', FakeResizeObserver);

const data: BarDatum[] = [
  { key: 'h6', label: '06:00', value: 0, peak: false, tooltip: '06:00 · 0' },
  {
    key: 'h7',
    label: '07:00',
    value: 54,
    peak: true,
    tooltip: '07:00–07:59 · 54 entradas (40 % del total)',
  },
  { key: 'h8', label: '08:00', value: 12, peak: false, tooltip: '08:00 · 12' },
];

describe('real bar chart', () => {
  it('labels the peak with the word and keeps empty hours at zero', async () => {
    const { container } = render(
      <RechartsBar
        data={data}
        ariaLabel="Entradas por hora; pico en 07:00 con 54"
        width={480}
        height={280}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: 'Entradas por hora; pico en 07:00 con 54',
      }),
    ).toBeTruthy();
    const text = container.textContent ?? '';
    expect(text).toContain('Pico 54');
    expect(text).toContain('07:00');
    expect(text).toContain('06:00');
    // The peak bar uses the pattern, not only the color.
    expect(container.innerHTML).toContain('gt-peak-pattern');
  });

  it('keeps the equivalent table with every value in the DOM', async () => {
    render(
      <BarChart
        title="Entradas por hora"
        subtitle="4 de mayo al 29 de mayo"
        data={data}
        ariaLabel="x"
        labelHeader="Hora"
        valueHeader="Entradas"
        width={480}
      />,
    );
    const row = await screen.findByRole('row', { name: /07:00/ });
    expect(row.textContent).toContain('54 (pico)');
    expect(
      screen.getByRole('button', { name: 'Ver datos como tabla' }),
    ).toBeTruthy();
  });
});
