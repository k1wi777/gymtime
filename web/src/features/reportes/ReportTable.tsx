'use client';

import { useMemo } from 'react';
import type { ReportColumn, ReportTable as Table } from '@/api/types';
import { Column, DataTable } from '@/ui/DataTable';
import { formatCell } from './format';

export type Row = Table['rows'][number];

interface Props {
  table: Table | undefined;
  caption: string;
  /** Frames the table in a titled card (administrator reports). */
  title?: string;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onSortChange?: (sort: { key: string; dir: 'asc' | 'desc' } | null) => void;
  /** Called with the student id of a row to open its detail (student groupings). */
  onOpenStudent?: (id: string, name: string) => void;
  emptyMessage?: string;
  pageSize?: number;
}

const NUMERIC = new Set<ReportColumn['type']>(['int', 'decimal', 'percent']);

/** Sort key of a cell: numbers as numbers, empty cells last (null). */
const sortValue = (column: ReportColumn, row: Row): string | number | null => {
  const value = row[column.key];
  if (value === null || value === undefined || value === '') return null;
  return NUMERIC.has(column.type) ? Number(value) : String(value);
};

/**
 * A report table built only from the `columns` and `rows` the server sends,
 * so the screen and the CSV cannot disagree about what a report contains.
 */
export function ReportTable({
  table,
  caption,
  title,
  loading,
  error,
  onRetry,
  onSortChange,
  onOpenStudent,
  emptyMessage = 'No hay datos con esos filtros.',
  pageSize = 25,
}: Props) {
  const columns = useMemo<Column<Row>[]>(
    () =>
      (table?.columns ?? []).map((column, index) => ({
        key: column.key,
        header: column.label,
        sortValue: (row: Row) => sortValue(column, row),
        render: (row: Row) => {
          const text = formatCell(column.type, row[column.key]);
          const studentId = row.id;
          if (index === 0 && onOpenStudent && typeof studentId === 'string') {
            return (
              <button
                type="button"
                className="btn btn-s"
                aria-label={`Ver detalle de ${text}`}
                onClick={() => onOpenStudent(studentId, text)}
              >
                {text}
              </button>
            );
          }
          return NUMERIC.has(column.type) ? (
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{text}</span>
          ) : (
            text
          );
        },
      })),
    [table?.columns, onOpenStudent],
  );
  const searchText = useMemo(
    () => (row: Row) =>
      (table?.columns ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => String(row[c.key] ?? ''))
        .join(' '),
    [table?.columns],
  );

  return (
    <DataTable<Row>
      caption={caption}
      {...(title ? { title } : {})}
      columns={columns}
      rows={table?.rows}
      rowKey={(row) => JSON.stringify(row)}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyMessage={emptyMessage}
      searchText={searchText}
      pageSize={pageSize}
      {...(onSortChange ? { onSortChange } : {})}
    />
  );
}
