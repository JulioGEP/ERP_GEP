import { useMemo, useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import type { ColumnDef } from '@tanstack/react-table';
import type { DealSummary } from '../../types/deal';
import { BudgetTable } from '../../features/presupuestos/BudgetTable';
import type { BudgetsPageProps } from './BudgetsPage';

type FollowUpField = 'caes_val' | 'fundae_val' | 'hotel_val' | 'transporte_val' | 'po_val';
type FollowUpParentKey = 'caes_label' | 'fundae_label' | 'hotel_label' | 'transporte' | 'po';

type FollowUpDefinition = {
  field: FollowUpField;
  parentKey: FollowUpParentKey;
  label: string;
};

const FOLLOW_UP_DEFINITIONS: readonly FollowUpDefinition[] = [
  { field: 'caes_val', parentKey: 'caes_label', label: 'CAES' },
  { field: 'fundae_val', parentKey: 'fundae_label', label: 'FUNDAE' },
  { field: 'hotel_val', parentKey: 'hotel_label', label: 'Hotel' },
  { field: 'transporte_val', parentKey: 'transporte', label: 'Transporte' },
  { field: 'po_val', parentKey: 'po', label: 'PO' },
];

function normalizeParentValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

function shouldHideCheckbox(parentValue: unknown): boolean {
  const normalized = normalizeParentValue(parentValue);
  if (!normalized) {
    return false;
  }
  return normalized === 'no' || normalized === 'no aplica';
}

function renderFollowUpHeader(label: string) {
  return (
    <span className="text-muted text-uppercase small fw-semibold d-block text-center">{label}</span>
  );
}

function createFollowUpColumns(): ColumnDef<DealSummary>[] {
  return FOLLOW_UP_DEFINITIONS.map(({ field, parentKey, label }) => ({
    id: field,
    header: () => renderFollowUpHeader(label),
    cell: ({ row }) => {
      const budget = row.original;
      if (shouldHideCheckbox(budget[parentKey])) {
        return <span className="d-block text-center text-muted">-</span>;
      }

      const checked = Boolean(budget[field]);
      return (
        <div className="d-flex justify-content-center" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            className="form-check-input position-static"
            checked={checked}
            readOnly
            disabled
            aria-label={`${label} validado`}
          />
        </div>
      );
    },
    enableSorting: false,
    meta: { style: { width: 120 } },
  }));
}

export type BudgetsUnworkedPageProps = BudgetsPageProps;

export function BudgetsUnworkedPage({
  budgets,
  isLoading,
  isFetching,
  error,
  onRetry,
  onSelect,
  onDelete,
  onOpenImportModal,
  isImporting,
}: BudgetsUnworkedPageProps) {
  const [filtersContainer, setFiltersContainer] = useState<HTMLDivElement | null>(null);

  const followUpColumns = useMemo(createFollowUpColumns, []);

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div className="d-flex flex-column gap-2">
          <div className="d-flex flex-wrap align-items-center gap-3">
            <h1 className="h3 fw-bold mb-0">Presupuestos · Sin trabajar</h1>
            <div ref={setFiltersContainer} className="d-flex align-items-center gap-2 flex-wrap" />
          </div>
          <p className="text-muted mb-0">
            Revisa de un vistazo qué validaciones de seguimiento están completas en cada presupuesto.
          </p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {(isImporting || isFetching) && <Spinner animation="border" role="status" size="sm" />}
          <Button size="lg" onClick={onOpenImportModal}>
            Importar presupuesto
          </Button>
        </div>
      </section>

      <BudgetTable
        budgets={budgets}
        isLoading={isLoading}
        isFetching={isFetching}
        error={error}
        onRetry={onRetry}
        onSelect={onSelect}
        onDelete={onDelete}
        filtersContainer={filtersContainer}
        extraColumns={followUpColumns}
      />
    </div>
  );
}

export default BudgetsUnworkedPage;
