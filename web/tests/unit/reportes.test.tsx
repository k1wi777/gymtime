import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ReportTable } from '@/features/reportes/ReportTable';
import { Reportes } from '@/features/reportes/Reportes';
import { Resumen } from '@/features/reportes/Resumen';
import {
  parseState,
  rangeProblem,
  toParams,
  toQuery,
} from '@/features/reportes/report-query';
import { landingFor, visibleItems } from '@/lib/nav';
import { safeNext } from '@/lib/validators';
import { installFakeApi, json } from './helpers';
import { nav } from './navigation-mock';

// The chart library is replaced by a double that lists what it would draw.
vi.mock('@/features/reportes/charts/RechartsBar', () => ({
  default: ({
    data,
    ariaLabel,
  }: {
    data: Array<{ key: string; label: string; value: number; peak: boolean }>;
    ariaLabel: string;
  }) => (
    <ul aria-label={`gráfica: ${ariaLabel}`}>
      {data.map((d) => (
        <li key={d.key}>{`${d.label}=${d.value}${d.peak ? ' pico' : ''}`}</li>
      ))}
    </ul>
  ),
}));

const OPTIONS = {
  defaultRange: { from: '2026-05-04', to: '2026-05-29' },
  maxRangeDays: 366,
  period: null,
  programs: ['Enfermería', 'Medicina'],
  schedules: [
    {
      id: 's1',
      name: 'Mañana',
      startTime: '06:00',
      endTime: '07:00',
      weekday: 1,
    },
  ],
};

const columns = [
  { key: 'name', label: 'Estudiante', type: 'text' },
  { key: 'attended', label: 'Asistencias', type: 'int' },
  { key: 'percent', label: 'Cumplimiento', type: 'percent' },
];
const filters = { from: '2026-05-04', to: '2026-05-29' };

const ATTENDANCE = {
  columns,
  filters,
  meta: {},
  rows: [
    { id: 'a', name: 'Ana', attended: 3, percent: 50 },
    { id: 'b', name: 'Beto', attended: 10, percent: null },
    { id: 'c', name: 'Carla', attended: 7, percent: 90.5 },
  ],
};

const FLOW = {
  columns: [
    { key: 'group', label: 'Grupo', type: 'text' },
    { key: 'count', label: 'Entradas', type: 'int' },
  ],
  filters,
  meta: {},
  rows: [{ group: '06:00', count: 9 }],
  total: 9,
  distinctStudents: 4,
  byHour: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: hour === 7 ? 9 : 0,
  })),
  byWeekday: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    count: weekday === 1 ? 9 : 0,
  })),
  peaks: {
    hours: [{ hour: 7, count: 9 }],
    weekdays: [{ weekday: 1, count: 9 }],
    dates: [{ date: '2026-05-04', count: 9 }],
  },
};

const setup = () =>
  installFakeApi({
    'GET /reports/options': OPTIONS,
    'GET /reports/flow': FLOW,
    'GET /reports/attendance': ATTENDANCE,
    'GET /reports/stay': ATTENDANCE,
    'GET /reports/late': ATTENDANCE,
    'GET /reports/quality': ATTENDANCE,
    'GET /reports/alarms': {
      ...ATTENDANCE,
      summary: {
        total: 2,
        closed: 1,
        open: 1,
        averageMinutes: 4,
        totalMinutes: 8,
      },
    },
  });

const lastQuery = (api: ReturnType<typeof setup>, key: string) => {
  const request = api.calls(key).at(-1);
  if (!request) throw new Error(`no ${key} request`);
  return Object.fromEntries(new URL(request.url).searchParams);
};

describe('report state and query (R12, R13)', () => {
  it('reads the address bar with defaults for the unknown', () => {
    const state = parseState(
      new URLSearchParams('reporte=asistencia&agrupar=month&desde=2026-05-04'),
    );
    expect(state.tab).toBe('asistencia');
    expect(state.groupBy).toBe('month');
    expect(state.filters.from).toBe('2026-05-04');
    expect(parseState(new URLSearchParams('reporte=x&agrupar=zz')).tab).toBe(
      'afluencia',
    );
    expect(
      parseState(new URLSearchParams('reporte=tardes&agrupar=month')).groupBy,
    ).toBe('student');
  });

  it('round-trips the state and leaves out empty filters', () => {
    const state = parseState(
      new URLSearchParams(
        'reporte=asistencia&programa=Medicina&desde=2026-05-04',
      ),
    );
    expect(toParams(state).toString()).toBe(
      'reporte=asistencia&agrupar=student&desde=2026-05-04&programa=Medicina',
    );
    expect(toQuery(state)).toEqual({
      from: '2026-05-04',
      program: 'Medicina',
      groupBy: 'student',
    });
  });

  it('ignores student and degree in the alarms report', () => {
    const state = parseState(
      new URLSearchParams('reporte=alarmas&programa=Medicina&estudiante=x'),
    );
    expect(toQuery(state)).toEqual({});
  });

  it('explains a bad range in Spanish', () => {
    expect(rangeProblem({ from: '2026-05-10', to: '2026-05-01' }, 366)).toMatch(
      /posterior/,
    );
    expect(rangeProblem({ from: '2025-01-01', to: '2026-05-01' }, 366)).toMatch(
      /366/,
    );
    expect(rangeProblem({ from: '2026-05-01', to: '2026-05-10' }, 366)).toBe(
      undefined,
    );
  });
});

describe('Reportes screen', () => {
  it('waits for the options, then loads the flow report and draws the charts', async () => {
    const api = setup();
    render(<Reportes />);
    expect(
      await screen.findByLabelText(
        'gráfica: Entradas por hora; pico en 07:00 con 9',
      ),
    ).toBeTruthy();
    expect(api.calls('GET /reports/options')).toHaveLength(1);
    const hours = screen.getByLabelText(/gráfica: Entradas por hora/);
    expect(within(hours).getByText('07:00=9 pico')).toBeTruthy();
    // The equivalent table is always in the DOM.
    expect(
      screen.getAllByRole('columnheader', { name: 'Entradas' }).length,
    ).toBeGreaterThan(0);
  });

  it('runs a new query when a filter changes and mirrors it in the address', async () => {
    const api = setup();
    render(<Reportes />);
    await screen.findByLabelText(/gráfica: Entradas por hora/);
    await userEvent.selectOptions(
      screen.getByLabelText('Programa'),
      'Medicina',
    );
    await waitFor(() =>
      expect(lastQuery(api, 'GET /reports/flow')).toMatchObject({
        program: 'Medicina',
      }),
    );
    expect(nav.replace).toHaveBeenLastCalledWith(
      expect.stringContaining('programa=Medicina'),
      { scroll: false },
    );
  });

  it('switches tabs, groups and keeps the filters', async () => {
    const api = setup();
    render(<Reportes />);
    await screen.findByLabelText(/gráfica: Entradas por hora/);
    await userEvent.selectOptions(
      screen.getByLabelText('Programa'),
      'Medicina',
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Asistencia' }));
    expect(await screen.findByText('Carla')).toBeTruthy();
    expect(lastQuery(api, 'GET /reports/attendance')).toMatchObject({
      program: 'Medicina',
      groupBy: 'student',
    });
    await userEvent.selectOptions(screen.getByLabelText('Agrupar'), 'month');
    await waitFor(() =>
      expect(lastQuery(api, 'GET /reports/attendance')).toMatchObject({
        groupBy: 'month',
      }),
    );
  });

  it('hides the student filters in the alarms report', async () => {
    const api = setup();
    render(<Reportes />);
    await screen.findByLabelText(/gráfica: Entradas por hora/);
    expect(screen.getByLabelText('Programa')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Alarmas' }));
    await waitFor(() =>
      expect(api.calls('GET /reports/alarms')).toHaveLength(1),
    );
    expect(screen.queryByLabelText('Programa')).toBeNull();
    expect(screen.queryByLabelText('Buscar estudiante')).toBeNull();
    expect(await screen.findByLabelText('Resumen de alarmas')).toBeTruthy();
  });

  it('does not query while the range is invalid', async () => {
    nav.search = 'reporte=asistencia&desde=2026-05-10&hasta=2026-05-01';
    const api = setup();
    render(<Reportes />);
    expect(await screen.findByText(/no puede ser posterior/)).toBeTruthy();
    expect(api.calls('GET /reports/attendance')).toHaveLength(0);
  });

  it('shows an error with retry and an empty state', async () => {
    nav.search = 'reporte=asistencia';
    const api = setup();
    api.route('GET /reports/attendance', () =>
      json({ statusCode: 500, message: 'boom' }, 500),
    );
    render(<Reportes />);
    expect(await screen.findByText('No se pudo cargar la lista')).toBeTruthy();
    api.route('GET /reports/attendance', { ...ATTENDANCE, rows: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(
      await screen.findByText('No hay datos con esos filtros.'),
    ).toBeTruthy();
  });

  it('exports with the filters on screen after the personal data warning', async () => {
    nav.search = 'reporte=asistencia&programa=Medicina';
    const api = setup();
    api.route(
      'GET /reports/attendance/export',
      () => new Response('a;b', { headers: { 'content-type': 'text/csv' } }),
    );
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(<Reportes />);
    await screen.findByText('Carla');
    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(screen.getByText(/datos personales/)).toBeTruthy();
    expect(api.calls('GET /reports/attendance/export')).toHaveLength(0);
    await userEvent.click(
      screen.getByRole('button', { name: 'Descargar el archivo' }),
    );
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(lastQuery(api, 'GET /reports/attendance/export')).toMatchObject({
      program: 'Medicina',
      groupBy: 'student',
    });
    click.mockRestore();
  });
});

describe('export keeps the order on screen (R20)', () => {
  it('sends sort and dir, and drops them when the table is remounted by a tab change', async () => {
    nav.search = 'reporte=asistencia';
    const api = setup();
    api.route(
      'GET /reports/attendance/export',
      () => new Response('a;b', { headers: { 'content-type': 'text/csv' } }),
    );
    api.route(
      'GET /reports/stay/export',
      () => new Response('a;b', { headers: { 'content-type': 'text/csv' } }),
    );
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:x'),
        revokeObjectURL: vi.fn(),
      }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]?.textContent);
    const exportNow = async (done: number) => {
      await userEvent.click(
        screen.getByRole('button', { name: 'Exportar CSV' }),
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Descargar el archivo' }),
      );
      await waitFor(() => expect(click).toHaveBeenCalledTimes(done));
    };
    render(<Reportes />);
    await screen.findByText('Carla');
    await userEvent.click(screen.getByRole('button', { name: /Asistencias/ }));
    await userEvent.click(screen.getByRole('button', { name: /Asistencias/ }));
    expect(names()).toEqual(['Beto', 'Carla', 'Ana']);
    await exportNow(1);
    expect(lastQuery(api, 'GET /reports/attendance/export')).toMatchObject({
      sort: 'attended',
      dir: 'desc',
    });

    await userEvent.click(screen.getByRole('tab', { name: 'Permanencia' }));
    await waitFor(() => expect(api.calls('GET /reports/stay')).toHaveLength(1));
    await screen.findByText('Carla');
    // Screen back to the default order, and so is the file.
    expect(names()).toEqual(['Ana', 'Beto', 'Carla']);
    await exportNow(2);
    const exported = lastQuery(api, 'GET /reports/stay/export');
    expect(exported.sort).toBeUndefined();
    expect(exported.dir).toBeUndefined();
    click.mockRestore();
  });
});

describe('export after changing the grouping (R20)', () => {
  it('drops sort and dir when Agrupar changes', async () => {
    nav.search = 'reporte=asistencia';
    const api = setup();
    api.route(
      'GET /reports/attendance/export',
      () => new Response('a;b', { headers: { 'content-type': 'text/csv' } }),
    );
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:x'),
        revokeObjectURL: vi.fn(),
      }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const names = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]?.textContent);
    render(<Reportes />);
    await screen.findByText('Carla');
    await userEvent.click(screen.getByRole('button', { name: /Asistencias/ }));
    await userEvent.click(screen.getByRole('button', { name: /Asistencias/ }));
    expect(names()).toEqual(['Beto', 'Carla', 'Ana']);
    await userEvent.selectOptions(screen.getByLabelText('Agrupar'), 'month');
    await waitFor(() =>
      expect(lastQuery(api, 'GET /reports/attendance')).toMatchObject({
        groupBy: 'month',
      }),
    );
    await screen.findByText('Carla');
    expect(names()).toEqual(['Ana', 'Beto', 'Carla']);
    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Descargar el archivo' }),
    );
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const exported = lastQuery(api, 'GET /reports/attendance/export');
    expect(exported).toMatchObject({ groupBy: 'month' });
    expect(exported.sort).toBeUndefined();
    expect(exported.dir).toBeUndefined();
    click.mockRestore();
  });
});

describe('ReportTable', () => {
  const table = ATTENDANCE as never;

  it('formats by type, shows a dash for empty and sorts empty last', async () => {
    const onSort = vi.fn();
    render(
      <ReportTable
        table={table}
        caption="t"
        loading={false}
        error={undefined}
        onRetry={() => undefined}
        onSortChange={onSort}
      />,
    );
    expect(screen.getByText('90,5 %')).toBeTruthy();
    const body = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0]?.textContent);
    await userEvent.click(screen.getByRole('button', { name: /Cumplimiento/ }));
    expect(body()).toEqual(['Ana', 'Carla', 'Beto']);
    await userEvent.click(screen.getByRole('button', { name: /Cumplimiento/ }));
    expect(body()).toEqual(['Carla', 'Ana', 'Beto']);
    expect(onSort).toHaveBeenLastCalledWith({ key: 'percent', dir: 'desc' });
  });

  it('filters by text', async () => {
    render(
      <ReportTable
        table={table}
        caption="t"
        loading={false}
        error={undefined}
        onRetry={() => undefined}
      />,
    );
    await userEvent.type(screen.getByLabelText('Buscar'), 'carl');
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getByText('Carla')).toBeTruthy();
  });
});

describe('summary and landing (R21)', () => {
  it('sends the administrator to the summary and the assistant to Ahora', () => {
    expect(landingFor('admin')).toBe('/admin/resumen');
    expect(landingFor('asistente')).toBe('/ahora');
    expect(safeNext(null, '/admin/resumen')).toBe('/admin/resumen');
    expect(safeNext('//evil', '/admin/resumen')).toBe('/admin/resumen');
    expect(safeNext('/admin/reportes', '/ahora')).toBe('/admin/reportes');
  });

  it('shows the reports entries only to the administrator', () => {
    expect(
      visibleItems('asistente').some((i) => i.href.includes('/admin/re')),
    ).toBe(false);
    const hrefs = visibleItems('admin').map((i) => i.href);
    expect(hrefs).toContain('/admin/resumen');
    expect(hrefs).toContain('/admin/reportes');
  });

  it('renders today, week, period and alerts', async () => {
    installFakeApi({
      'GET /reports/summary': {
        date: '2026-05-29',
        weekStart: '2026-05-25',
        today: {
          attended: 5,
          obligations: 8,
          compliance: 62.5,
          entries: 6,
          inside: 2,
        },
        week: { attended: 20, obligations: 40, compliance: 50, entries: 22 },
        period: null,
        alerts: {
          alarmOn: false,
          device: { known: true, online: true },
          staleOpen: 1,
          unregistered7d: 3,
        },
      },
    });
    render(<Resumen />);
    const today = await screen.findByRole('region', { name: 'Hoy' });
    expect(within(today).getByText('62,5 %')).toBeTruthy();
    expect(screen.getByText('No hay un periodo activo.')).toBeTruthy();
    expect(screen.getByText('Lector en línea')).toBeTruthy();
  });
});
