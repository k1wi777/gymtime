'use client';

import { call, getApi } from '@/api/client';
import { useResource } from '@/lib/use-resource';
import { ReportTable } from './ReportTable';
import type { Filters } from './report-query';

interface Props {
  studentId: string;
  filters: Filters;
  onClose: () => void;
}

/** Day by day account of one student in the range (names only, no document). */
export function EstudianteDetalle({ studentId, filters, onClose }: Props) {
  const detail = useResource(
    (signal) =>
      call(
        getApi().client.GET('/reports/students/{id}', {
          params: {
            path: { id: studentId },
            query: {
              ...(filters.from ? { from: filters.from } : {}),
              ...(filters.to ? { to: filters.to } : {}),
              ...(filters.scheduleId ? { scheduleId: filters.scheduleId } : {}),
            },
          },
          signal,
        }),
      ),
    [studentId, filters.from, filters.to, filters.scheduleId],
  );
  const student = detail.data?.student;
  return (
    <section className="card stack" aria-label="Detalle del estudiante">
      <div className="row">
        <h3>
          {student
            ? `${student.name}${student.program ? ` · ${student.program}` : ''}`
            : 'Detalle del estudiante'}
        </h3>
        <button type="button" className="btn" onClick={onClose}>
          Cerrar detalle
        </button>
      </div>
      <ReportTable
        table={detail.data}
        caption="Detalle por sesión del estudiante"
        loading={detail.loading}
        error={detail.error}
        onRetry={detail.reload}
        emptyMessage="El estudiante no tiene sesiones en ese rango."
      />
    </section>
  );
}
