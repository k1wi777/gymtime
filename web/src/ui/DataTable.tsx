'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { describeError } from '@/api/errors';
import { Notice } from './Notice';
import { Spinner } from './Spinner';
import styles from './DataTable.module.css';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Makes the column sortable by this value; null always goes last. */
  sortValue?: (row: T) => string | number | null;
}

export interface SelectFilter<T> {
  id: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  matches: (row: T, value: string) => boolean;
}

interface Props<T> {
  caption: string;
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  emptyMessage?: string;
  /** Enables the text filter over this text of each row. */
  searchText?: (row: T) => string;
  selects?: ReadonlyArray<SelectFilter<T>>;
  pageSize?: number;
  /** Tells the owner the sort in force (null = none), e.g. to export in that order. */
  onSortChange?: (sort: { key: string; dir: 'asc' | 'desc' } | null) => void;
}

const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Table with text and select filters, single-column sorting and client-side
 * pagination, plus the loading, error and empty states of every list.
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  emptyMessage = 'No hay datos para mostrar.',
  searchText,
  selects = [],
  pageSize = 10,
  onSortChange,
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const visible = useMemo(() => {
    let result = [...(rows ?? [])];
    const needle = normalize(query.trim());
    if (searchText && needle !== '') {
      result = result.filter((row) =>
        normalize(searchText(row)).includes(needle),
      );
    }
    for (const select of selects) {
      const value = chosen[select.id];
      if (value) result = result.filter((row) => select.matches(row, value));
    }
    const column = columns.find((c) => c.key === sort?.key);
    if (sort && column?.sortValue) {
      const value = column.sortValue;
      result.sort((a, b) => {
        const x = value(a);
        const y = value(b);
        if (x === null || y === null) {
          return x === y ? 0 : x === null ? 1 : -1;
        }
        const order =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x).localeCompare(String(y), 'es');
        return order * sort.dir;
      });
    }
    return result;
  }, [rows, query, chosen, sort, columns, searchText, selects]);

  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = visible.slice(current * pageSize, (current + 1) * pageSize);

  if (error) {
    return (
      <Notice
        kind="error"
        title="No se pudo cargar la lista"
        actions={
          onRetry && (
            <button type="button" className="btn" onClick={onRetry}>
              Reintentar
            </button>
          )
        }
      >
        {describeError(error)}
      </Notice>
    );
  }
  if (loading && !rows) return <Spinner />;

  return (
    <div className="stack">
      {(searchText || selects.length > 0) && (
        <div className="row">
          {searchText && (
            <label className={styles.filter}>
              <span>Buscar</span>
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
                className={styles.input}
              />
            </label>
          )}
          {selects.map((select) => (
            <label key={select.id} className={styles.filter}>
              <span>{select.label}</span>
              <select
                value={chosen[select.id] ?? ''}
                onChange={(event) => {
                  setChosen({ ...chosen, [select.id]: event.target.value });
                  setPage(0);
                }}
                className={styles.input}
              >
                <option value="">Todos</option>
                {select.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const sorted = sort?.key === column.key ? sort.dir : 0;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      sorted === 0
                        ? undefined
                        : sorted === 1
                          ? 'ascending'
                          : 'descending'
                    }
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        className={styles.sortButton}
                        onClick={() => {
                          const dir = sorted === 1 ? -1 : 1;
                          setSort({ key: column.key, dir });
                          onSortChange?.({
                            key: column.key,
                            dir: dir === 1 ? 'asc' : 'desc',
                          });
                        }}
                      >
                        {column.header}
                        {sorted === 0 ? '' : sorted === 1 ? ' ▲' : ' ▼'}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && <p className="muted">{emptyMessage}</p>}
      {pages > 1 && (
        <nav className="row" aria-label="Paginación">
          <button
            type="button"
            className="btn"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Anterior
          </button>
          <span>
            Página {current + 1} de {pages}
          </span>
          <button
            type="button"
            className="btn"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Siguiente
          </button>
        </nav>
      )}
    </div>
  );
}
