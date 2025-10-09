import { useEffect, useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export type SortState = {
  column: string | null;
  direction: SortDirection;
};

export type SortableValue = string | number | boolean | Date | null | undefined;

export type UseDataTableOptions<T> = {
  pageSize?: number;
  initialSort?: { column: string; direction?: SortDirection };
  getSortValue?: (item: T, column: string) => SortableValue;
};

function normalizeValue(value: SortableValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;

  const text = String(value).trim().toLowerCase();
  return text.length ? text : '';
}

function compareValues(a: SortableValue, b: SortableValue): number {
  const normalizedA = normalizeValue(a);
  const normalizedB = normalizeValue(b);

  if (normalizedA === normalizedB) return 0;
  if (normalizedA === null) return 1;
  if (normalizedB === null) return -1;

  if (typeof normalizedA === 'number' && typeof normalizedB === 'number') {
    return normalizedA - normalizedB;
  }

  return String(normalizedA).localeCompare(String(normalizedB), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

export function useDataTable<T>(items: T[], options?: UseDataTableOptions<T>) {
  const { pageSize = 25, initialSort, getSortValue } = options ?? {};

  const [sortState, setSortState] = useState<SortState>(() => {
    if (initialSort?.column) {
      return {
        column: initialSort.column,
        direction: initialSort.direction ?? 'asc',
      };
    }
    return { column: null, direction: 'asc' };
  });

  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [items]);

  useEffect(() => {
    if (!sortState.column && initialSort?.column) {
      setSortState({
        column: initialSort.column,
        direction: initialSort.direction ?? 'asc',
      });
    }
  }, [initialSort?.column, initialSort?.direction, sortState.column]);

  const sortedItems = useMemo(() => {
    if (!items.length) return [] as T[];

    const data = [...items];
    const { column, direction } = sortState;

    if (!column) return data;

    return data.sort((left, right) => {
      const leftValue = getSortValue ? getSortValue(left, column) : (left as any)[column];
      const rightValue = getSortValue ? getSortValue(right, column) : (right as any)[column];

      const result = compareValues(leftValue, rightValue);
      return direction === 'asc' ? result : -result;
    });
  }, [items, sortState, getSortValue]);

  const totalItems = sortedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return sortedItems.slice(startIndex, startIndex + pageSize);
  }, [sortedItems, currentPage, pageSize]);

  const requestSort = (column: string) => {
    setSortState((prev) => {
      if (prev.column === column) {
        const nextDirection: SortDirection = prev.direction === 'asc' ? 'desc' : 'asc';
        return { column, direction: nextDirection };
      }

      return { column, direction: 'asc' };
    });
    setPage(1);
  };

  const goToPage = (nextPage: number) => {
    if (!Number.isFinite(nextPage)) return;
    const safePage = Math.min(Math.max(1, Math.trunc(nextPage)), totalPages);
    setPage(safePage);
  };

  return {
    pageItems,
    sortState,
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    requestSort,
    goToPage,
    canGoPrev: currentPage > 1,
    canGoNext: currentPage < totalPages,
  };
}
