import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type SortingState = { id: string; desc?: boolean }[];

export type HeaderContext<TData, TValue> = {
  header: Header<TData>;
  column: ColumnInstance<TData, TValue>;
  table: Table<TData>;
};

export type CellContext<TData, TValue> = {
  cell: Cell<TData>;
  row: Row<TData>;
  column: ColumnInstance<TData, TValue>;
  table: Table<TData>;
  getValue: () => TValue;
  renderValue: () => ReactNode;
};

export type ColumnDef<TData, TValue> = {
  id?: string;
  header?: ReactNode | ((context: HeaderContext<TData, TValue>) => ReactNode);
  cell?: (context: CellContext<TData, TValue>) => ReactNode;
  accessorKey?: string;
  accessorFn?: (row: TData) => TValue;
  enableSorting?: boolean;
  meta?: Record<string, unknown>;
};

export function flexRender<TContext>(
  component: ReactNode | ((context: TContext) => ReactNode),
  context: TContext,
): ReactNode {
  if (typeof component === 'function') {
    return (component as (context: TContext) => ReactNode)(context);
  }
  return component ?? null;
}

export type ColumnInstance<TData, TValue> = {
  id: string;
  columnDef: ColumnDef<TData, TValue>;
  accessor: (row: TData) => TValue;
  enableSorting: boolean;
  getCanSort: () => boolean;
  getIsSorted: () => false | 'asc' | 'desc';
  getToggleSortingHandler: () => () => void;
};

export type Cell<TData> = {
  id: string;
  column: ColumnInstance<TData, unknown>;
  row: Row<TData>;
  getValue: () => unknown;
  renderValue: () => ReactNode;
  getContext: () => CellContext<TData, unknown>;
};

export type Row<TData> = {
  id: string;
  original: TData;
  getValue: (columnId: string) => unknown;
  getVisibleCells: () => Cell<TData>[];
};

export type Header<TData> = {
  id: string;
  column: ColumnInstance<TData, unknown>;
  colSpan: number;
  isPlaceholder: boolean;
  columnDef: ColumnDef<TData, unknown>;
  renderHeader: () => ReactNode;
  getContext: () => HeaderContext<TData, unknown>;
};

export type HeaderGroup<TData> = {
  id: string;
  headers: Header<TData>[];
};

export type RowModel<TData> = {
  rows: Row<TData>[];
};

export type TableState = {
  sorting: SortingState;
};

export type Table<TData> = {
  options: UseReactTableOptions<TData>;
  getHeaderGroups: () => HeaderGroup<TData>[];
  getRowModel: () => RowModel<TData>;
  getAllColumns: () => ColumnInstance<TData, unknown>[];
  getState: () => TableState;
  setSorting: (
    updater: SortingState | ((previous: SortingState) => SortingState),
  ) => void;
};

export type UseReactTableOptions<TData> = {
  data: TData[];
  columns: ColumnDef<TData, unknown>[];
  state?: Partial<TableState>;
  onSortingChange?: (sorting: SortingState) => void;
  getRowId?: (row: TData, index: number) => string;
  getCoreRowModel?: unknown;
  getSortedRowModel?: unknown;
};

export function getCoreRowModel<TData>() {
  return (table: Table<TData>): RowModel<TData> => table.getRowModel();
}

export function getSortedRowModel<TData>() {
  return (table: Table<TData>): RowModel<TData> => table.getRowModel();
}

function getByPath(source: unknown, path: string): unknown {
  if (!path.length) return undefined;
  const parts = path.split('.');
  let current: any = source;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function normalizeString(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function compareValues(a: unknown, b: unknown): number {
  const normalizedA = a == null ? null : a;
  const normalizedB = b == null ? null : b;

  if (normalizedA === normalizedB) return 0;
  if (normalizedA == null) return 1;
  if (normalizedB == null) return -1;

  if (typeof normalizedA === 'number' && typeof normalizedB === 'number') {
    return normalizedA - normalizedB;
  }

  if (normalizedA instanceof Date && normalizedB instanceof Date) {
    return normalizedA.getTime() - normalizedB.getTime();
  }

  return normalizeString(normalizedA).localeCompare(normalizeString(normalizedB), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

function createAccessor<TData, TValue>(
  columnDef: ColumnDef<TData, TValue>,
  fallbackId: string,
): (row: TData) => TValue {
  if (typeof columnDef.accessorFn === 'function') {
    return columnDef.accessorFn;
  }
  if (typeof columnDef.accessorKey === 'string') {
    return (row: TData) => getByPath(row, columnDef.accessorKey!) as TValue;
  }
  return (row: TData) => (row as any)[fallbackId] as TValue;
}

function applySorting<TData>(
  data: TData[],
  columns: ColumnInstance<TData, unknown>[],
  sorting: SortingState,
): TData[] {
  if (!sorting.length) return data;
  const [first] = sorting;
  const column = columns.find((col) => col.id === first.id);
  if (!column) return data;
  const sorted = [...data];
  sorted.sort((left, right) => {
    const leftValue = column.accessor(left);
    const rightValue = column.accessor(right);
    const result = compareValues(leftValue, rightValue);
    return first.desc ? -result : result;
  });
  return sorted;
}

type RawRow<TData> = {
  id: string;
  original: TData;
};

function createRow<TData>(
  raw: RawRow<TData>,
  columns: ColumnInstance<TData, unknown>[],
  table: Table<TData>,
): Row<TData> {
  const row: Row<TData> = {
    id: raw.id,
    original: raw.original,
    getValue: (columnId: string) => {
      const column = columns.find((col) => col.id === columnId);
      return column ? column.accessor(raw.original) : undefined;
    },
    getVisibleCells: () =>
      columns.map((column) => {
        const cell: Cell<TData> = {
          id: `${raw.id}_${column.id}`,
          column,
          row,
          getValue: () => column.accessor(raw.original),
          renderValue: () => {
            const cellRenderer = column.columnDef.cell;
            if (typeof cellRenderer === 'function') {
              return cellRenderer(cell.getContext());
            }
            return cell.getValue() as ReactNode;
          },
          getContext: () => ({
            cell,
            column,
            row,
            table,
            getValue: cell.getValue,
            renderValue: cell.renderValue,
          }),
        };
        return cell;
      }),
  };
  return row;
}

function createHeaderGroups<TData>(
  columns: ColumnInstance<TData, unknown>[],
  table: Table<TData>,
): HeaderGroup<TData>[] {
  return [
    {
      id: 'header',
      headers: columns.map((column) => {
        const header: Header<TData> = {
          id: column.id,
          column,
          colSpan: 1,
          isPlaceholder: false,
          columnDef: column.columnDef,
          renderHeader: () => {
            const headerRenderer = column.columnDef.header;
            if (typeof headerRenderer === 'function') {
              return headerRenderer(header.getContext());
            }
            if (headerRenderer != null) return headerRenderer;
            return column.id;
          },
          getContext: () => ({ header, column, table }),
        };
        return header;
      }),
    },
  ];
}

function createColumnInstances<TData>(
  columnDefs: ColumnDef<TData, unknown>[],
  getSorting: () => SortingState,
  updateSorting: (
    updater: SortingState | ((previous: SortingState) => SortingState),
  ) => void,
): ColumnInstance<TData, unknown>[] {
  return columnDefs.map((columnDef, index) => {
    const fallbackId = columnDef.id ?? columnDef.accessorKey ?? `col_${index}`;
    const id = String(fallbackId);
    const accessor = createAccessor(columnDef, id);
    const enableSorting = columnDef.enableSorting !== false;

    return {
      id,
      columnDef,
      accessor,
      enableSorting,
      getCanSort: () => enableSorting,
      getIsSorted: () => {
        const current = getSorting().find((item) => item.id === id);
        if (!current) return false;
        return current.desc ? 'desc' : 'asc';
      },
      getToggleSortingHandler: () => () => {
        if (!enableSorting) return;
        updateSorting((previous) => {
          const current = previous.find((item) => item.id === id);
          if (!current) {
            return [{ id, desc: false }];
          }
          if (!current.desc) {
            return [{ id, desc: true }];
          }
          return [];
        });
      },
    };
  });
}

export function useReactTable<TData>(options: UseReactTableOptions<TData>): Table<TData> {
  const { data, columns: columnDefs, state, onSortingChange, getRowId } = options;
  const [sorting, setSorting] = useState<SortingState>(state?.sorting ?? []);

  useEffect(() => {
    if (state?.sorting) {
      setSorting(state.sorting);
    }
  }, [state?.sorting]);

  const updateSorting = useCallback(
    (
      updater: SortingState | ((previous: SortingState) => SortingState),
    ) => {
      setSorting((previous) => {
        const next = typeof updater === 'function' ? updater(previous) : updater;
        onSortingChange?.(next);
        return next;
      });
    },
    [onSortingChange],
  );

  const getSorting = useCallback(() => sorting, [sorting]);

  const columns = useMemo(
    () => createColumnInstances(columnDefs, getSorting, updateSorting),
    [columnDefs, getSorting, updateSorting],
  );

  const sortedData = useMemo(
    () => applySorting(data, columns, sorting),
    [columns, data, sorting],
  );

  const rawRows = useMemo<RawRow<TData>[]>(
    () =>
      sortedData.map((item, index) => ({
        id: getRowId ? getRowId(item, index) : String(index),
        original: item,
      })),
    [getRowId, sortedData],
  );

  const table = useMemo<Table<TData>>(() => {
    const tableInstance: Table<TData> = {
      options,
      getHeaderGroups: () => createHeaderGroups(columns, tableInstance),
      getRowModel: () => ({
        rows: rawRows.map((raw) => createRow(raw, columns, tableInstance)),
      }),
      getAllColumns: () => columns,
      getState: () => ({ sorting }),
      setSorting: updateSorting,
    };
    return tableInstance;
  }, [columns, rawRows, sorting, updateSorting, options]);

  return table;
}
