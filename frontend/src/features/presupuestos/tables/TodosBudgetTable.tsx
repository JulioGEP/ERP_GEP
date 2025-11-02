import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BudgetTable, type BudgetTableProps } from '../BudgetTable';

export type TodosBudgetTableProps = BudgetTableProps;

/**
 * Tabla para la vista de "Todos". Se fuerza la desactivación del fallback para
 * evitar mostrar datos cacheados cuando se revisa el histórico completo.
 */
const FILTER_PREFIX = 'budgets-table__filter__';
const SEARCH_KEY = 'budgets-table__search';
const SORT_KEY = 'budgets-table__sort';

export function TodosBudgetTable(props: TodosBudgetTableProps) {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    // En la vista de "Todos" los filtros no deben persistir entre pestañas,
    // por lo que se eliminan los parámetros aplicados en otras subrutas.
    const keysToRemove: string[] = [];
    searchParams.forEach((_, key) => {
      if (key === SEARCH_KEY || key === SORT_KEY || key.startsWith(FILTER_PREFIX)) {
        keysToRemove.push(key);
      }
    });

    if (!keysToRemove.length) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    keysToRemove.forEach((key) => {
      nextParams.delete(key);
    });

    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  return <BudgetTable {...props} enableFallback={false} />;
}
