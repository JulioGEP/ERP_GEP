import { BudgetTable, type BudgetTableProps } from '../BudgetTable';

export type SinPlanificarBudgetTableProps = BudgetTableProps;

/**
 * Tabla específica para la vista de "Sin planificar". Mantiene la lógica de
 * fallback porque la planificación depende de los últimos datos cacheados.
 */
export function SinPlanificarBudgetTable(props: SinPlanificarBudgetTableProps) {
  return <BudgetTable {...props} enableFallback showFilters />;
}
