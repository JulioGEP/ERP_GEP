import { BudgetTable, type BudgetTableProps } from '../BudgetTable';

export type SinTrabajarBudgetTableProps = BudgetTableProps;

/**
 * Tabla dedicada a la vista de "Sin trabajar". Obliga a refrescar la
 * información en cada consulta para revisar el estado de los campos especiales.
 */
export function SinTrabajarBudgetTable(props: SinTrabajarBudgetTableProps) {
  return <BudgetTable {...props} enableFallback={false} showFilters />;
}
