'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { call, getApi } from '@/api/client';
import type { FlowReport, ReportTable as Table } from '@/api/types';
import { useResource } from '@/lib/use-resource';
import { Notice } from '@/ui/Notice';
import { PageHeader } from '@/ui/PageHeader';
import { Spinner } from '@/ui/Spinner';
import { BarChart } from './BarChart';
import { EstudianteDetalle } from './EstudianteDetalle';
import { ExportButton } from './ExportButton';
import { FiltrosReporte } from './FiltrosReporte';
import {
  hourSeries,
  peakDatesSeries,
  peakHoursSeries,
  summarize,
  weekdaySeries,
} from './flow-series';
import { formatDay } from '@/lib/time';
import { ReportTable } from './ReportTable';
import {
  parseState,
  rangeProblem,
  TABS,
  tabOf,
  toParams,
  toQuery,
  type Filters,
  type GroupBy,
  type ReportState,
  type TabId,
} from './report-query';
import styles from './Reportes.module.css';

type Sort = { key: string; dir: 'asc' | 'desc' } | null;

function FlowCharts({
  flow,
  subtitle,
}: {
  flow: FlowReport;
  subtitle: string;
}) {
  const hours = hourSeries(flow);
  const weekdays = weekdaySeries(flow);
  const peakHours = peakHoursSeries(flow);
  const peakDates = peakDatesSeries(flow);
  return (
    <div className={styles.grid}>
      <BarChart
        color="var(--chart-1)"
        title="Entradas por hora"
        subtitle={subtitle}
        data={hours}
        ariaLabel={summarize('Entradas por hora', hours)}
        labelHeader="Hora"
        valueHeader="Entradas"
      />
      <BarChart
        color="var(--chart-2)"
        title="Entradas por día de la semana"
        subtitle={subtitle}
        data={weekdays}
        ariaLabel={summarize('Entradas por día de la semana', weekdays)}
        labelHeader="Día"
        valueHeader="Entradas"
      />
      <BarChart
        color="var(--chart-3)"
        title="Horas pico"
        subtitle={subtitle}
        data={peakHours}
        ariaLabel={summarize('Horas pico', peakHours)}
        labelHeader="Hora"
        valueHeader="Entradas"
      />
      <BarChart
        color="var(--chart-4)"
        title="Fechas pico"
        subtitle={subtitle}
        data={peakDates}
        ariaLabel={summarize('Fechas pico', peakDates, 'máximo')}
        labelHeader="Fecha"
        valueHeader="Entradas"
      />
    </div>
  );
}

export function Reportes() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  // The state is the source of truth; the address bar mirrors it.
  const [state, setState] = useState<ReportState>(() =>
    parseState(new URLSearchParams(search.toString())),
  );
  const [sort, setSort] = useState<Sort>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const update = useCallback(
    (next: ReportState) => {
      setState(next);
      router.replace(`${pathname}?${toParams(next).toString()}`, {
        scroll: false,
      });
    },
    [router, pathname],
  );

  const options = useResource(
    (signal) => call(getApi().client.GET('/reports/options', { signal })),
    [],
  );
  const maxDays = options.data?.maxRangeDays ?? 366;
  const problem = rangeProblem(state.filters, maxDays);
  const tab = tabOf(state.tab);
  const query = useMemo(() => toQuery(state), [state]);
  const queryKey = JSON.stringify([tab.kind, query]);
  const ready = options.data !== undefined && problem === undefined;

  const report = useResource(
    async (signal) => {
      if (!ready) return undefined;
      const path = `/reports/${tab.kind}` as '/reports/attendance';
      const result = await call(
        getApi().client.GET(path, { params: { query }, signal }),
      );
      return result as unknown as Table & Partial<FlowReport>;
    },
    [ready, queryKey],
  );

  const data = report.data;
  const range = data?.filters ?? options.data?.defaultRange;
  const from = range?.from ?? '';
  const to = range?.to ?? '';
  const subtitle = from && to ? `${formatDay(from)} al ${formatDay(to)}` : '';
  const isFlow = tab.kind === 'flow';
  const groupedByStudent =
    state.groupBy === 'student' &&
    (tab.kind === 'attendance' || tab.kind === 'stay' || tab.kind === 'late');

  const setFilters = (filters: Filters) => update({ ...state, filters });
  const setTab = (id: TabId) => {
    setSort(null);
    setDetailId(null);
    update(parseState(toParams({ ...state, tab: id })));
  };
  const setGroupBy = (groupBy: GroupBy) => {
    setSort(null);
    update({ ...state, groupBy });
  };

  return (
    <div>
      <PageHeader
        crumb="Reportes"
        title="Reportes"
        lead={range ? `Rango: ${subtitle}` : 'Elija el rango del reporte.'}
        aside={
          <div className={styles.exportBox}>
            <ExportButton
              kind={tab.kind}
              query={query}
              sort={sort}
              range={{ from, to }}
              disabled={!ready || !data || data.rows.length === 0}
            />
          </div>
        }
      />
      <div className={styles.main}>
        {options.error !== undefined && (
          <Notice kind="error" title="No se pudieron cargar las opciones">
            <button type="button" className="btn" onClick={options.reload}>
              Reintentar
            </button>
          </Notice>
        )}
        {options.data && (
          <FiltrosReporte
            kind={tab.kind}
            options={options.data}
            filters={state.filters}
            groupBy={state.groupBy}
            onFilters={setFilters}
            onGroupBy={setGroupBy}
          />
        )}
        {options.loading && <Spinner label="Cargando opciones…" />}

        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Tipo de reporte"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={t.id === state.tab}
              aria-controls="reporte-panel"
              className={styles.tab}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div
          id="reporte-panel"
          role="tabpanel"
          aria-labelledby={`tab-${state.tab}`}
          className={styles.panel}
        >
          {isFlow && data?.byHour && (
            <FlowCharts flow={data as FlowReport} subtitle={subtitle} />
          )}
          {tab.kind === 'alarms' && data && 'summary' in data && (
            <AlarmsSummary
              summary={(data as { summary: AlarmsSummaryData }).summary}
            />
          )}
          {/* Remounted per tab and grouping: its sort state must match `sort`. */}
          <ReportTable
            key={`${state.tab}:${state.groupBy}`}
            table={data}
            title="Datos en tabla"
            caption={`Reporte de ${tab.label.toLowerCase()}`}
            loading={options.loading || (ready && report.loading)}
            error={report.error}
            onRetry={report.reload}
            onSortChange={setSort}
            {...(groupedByStudent
              ? {
                  onOpenStudent: (id: string) => setDetailId(id),
                }
              : {})}
          />
          {detailId && (
            <EstudianteDetalle
              studentId={detailId}
              filters={state.filters}
              onClose={() => setDetailId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface AlarmsSummaryData {
  total: number;
  closed: number;
  open: number;
  averageMinutes: number | null;
  totalMinutes: number;
}

function AlarmsSummary({ summary }: { summary: AlarmsSummaryData }) {
  return (
    <dl className={`card ${styles.dl}`} aria-label="Resumen de alarmas">
      <dt>Alarmas</dt>
      <dd>{summary.total}</dd>
      <dt>Cerradas</dt>
      <dd>{summary.closed}</dd>
      <dt>Abiertas</dt>
      <dd>{summary.open}</dd>
      <dt>Duración promedio (min)</dt>
      <dd>{summary.averageMinutes ?? '—'}</dd>
    </dl>
  );
}
