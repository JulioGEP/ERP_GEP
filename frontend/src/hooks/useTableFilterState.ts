import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

type SortingItem = { id: string; desc: boolean };

export type TableSortingState = SortingItem[];

export type TableFiltersState = Record<string, string[]>;

export interface UseTableFilterStateOptions {
  tableKey: string;
}

function parseSortingParam(param: string | null): TableSortingState {
  if (!param) return [];
  return param
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length)
    .map((part) => {
      const [id, direction] = part.split(':');
      if (!id) return null;
      const normalizedId = decodeURIComponent(id);
      const desc = direction === 'desc';
      return { id: normalizedId, desc } as SortingItem;
    })
    .filter((item): item is SortingItem => Boolean(item?.id));
}

function buildSortingParam(state: TableSortingState): string | null {
  if (!state.length) return null;
  const encoded = state
    .filter((item) => item.id)
    .map((item) => `${encodeURIComponent(item.id)}:${item.desc ? 'desc' : 'asc'}`)
    .join(',');
  return encoded.length ? encoded : null;
}

export function useTableFilterState({ tableKey }: UseTableFilterStateOptions) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filterPrefix = `${tableKey}__filter__`;
  const searchKey = `${tableKey}__search`;
  const sortKey = `${tableKey}__sort`;

  const filters = useMemo(() => {
    const entries = Array.from(searchParams.entries());
    const active: TableFiltersState = {};
    for (const [key, value] of entries) {
      if (key.startsWith(filterPrefix)) {
        const filterKey = decodeURIComponent(key.slice(filterPrefix.length));
        if (filterKey.length) {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              const normalized = parsed
                .map((item) => String(item).trim())
                .filter((item) => item.length > 0);
              if (normalized.length) {
                active[filterKey] = normalized;
                continue;
              }
            } else if (typeof parsed === 'string' && parsed.trim().length) {
              active[filterKey] = [parsed.trim()];
              continue;
            }
          } catch {
            /* ignore malformed JSON */
          }

          const trimmed = value.trim();
          if (trimmed.length) {
            active[filterKey] = [trimmed];
          }
        }
      }
    }
    return active;
  }, [filterPrefix, searchParams]);

  const searchValue = searchParams.get(searchKey) ?? '';
  const sorting = useMemo(() => parseSortingParam(searchParams.get(sortKey)), [searchParams, sortKey]);

  const updateSearchParams = useCallback(
    (updater: (draft: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      updater(next);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setFilterValue = useCallback(
    (key: string, value: string | string[] | null) => {
      const normalizedKey = key.trim();
      if (!normalizedKey.length) return;
      updateSearchParams((draft) => {
        const paramKey = `${filterPrefix}${encodeURIComponent(normalizedKey)}`;
        const valuesArray = Array.isArray(value) ? value : value ? [value] : [];
        const sanitized = valuesArray.map((item) => item.trim()).filter((item) => item.length > 0);
        if (!sanitized.length) {
          draft.delete(paramKey);
          return;
        }

        const payload = JSON.stringify(Array.from(new Set(sanitized)));
        draft.set(paramKey, payload);
      });
    },
    [filterPrefix, updateSearchParams],
  );

  const clearFilter = useCallback(
    (key: string) => {
      const normalizedKey = key.trim();
      if (!normalizedKey.length) return;
      updateSearchParams((draft) => {
        const paramKey = `${filterPrefix}${encodeURIComponent(normalizedKey)}`;
        draft.delete(paramKey);
      });
    },
    [filterPrefix, updateSearchParams],
  );

  const clearAllFilters = useCallback(() => {
    updateSearchParams((draft) => {
      const keys = Array.from(draft.keys());
      keys.forEach((key) => {
        if (key.startsWith(filterPrefix)) {
          draft.delete(key);
        }
      });
      draft.delete(searchKey);
      draft.delete(sortKey);
    });
  }, [filterPrefix, searchKey, sortKey, updateSearchParams]);

  const setSearchValue = useCallback(
    (value: string) => {
      updateSearchParams((draft) => {
        if (value.trim().length) {
          draft.set(searchKey, value);
        } else {
          draft.delete(searchKey);
        }
      });
    },
    [searchKey, updateSearchParams],
  );

  const setSorting = useCallback(
    (value: TableSortingState | null) => {
      updateSearchParams((draft) => {
        const nextValue = buildSortingParam(value ?? []);
        if (nextValue) {
          draft.set(sortKey, nextValue);
        } else {
          draft.delete(sortKey);
        }
      });
    },
    [sortKey, updateSearchParams],
  );

  return {
    filters,
    searchValue,
    sorting,
    setSearchValue,
    setFilterValue,
    clearFilter,
    clearAllFilters,
    setSorting,
  };
}
