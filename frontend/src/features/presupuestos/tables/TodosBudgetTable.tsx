import { BudgetTable, type BudgetTableProps } from '../BudgetTable';

export type TodosBudgetTableProps = BudgetTableProps;

/**
 * Tabla para la vista de "Todos". Se fuerza la desactivación del fallback para
 * evitar mostrar datos cacheados cuando se revisa el histórico completo.
 */
export function TodosBudgetTable(props: TodosBudgetTableProps) {
  return <BudgetTable {...props} enableFallback={false} />;
}
