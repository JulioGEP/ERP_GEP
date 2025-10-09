import type { CSSProperties, ReactNode } from 'react';
import { SortState } from '../../hooks/useDataTable';

interface SortableHeaderProps {
  columnKey: string;
  label: ReactNode;
  sortState: SortState;
  onSort: (columnKey: string) => void;
  className?: string;
  style?: CSSProperties;
  align?: 'start' | 'center' | 'end';
}

export function SortableHeader({
  columnKey,
  label,
  sortState,
  onSort,
  className,
  style,
  align = 'start',
}: SortableHeaderProps) {
  const isActive = sortState.column === columnKey;
  const direction = isActive ? sortState.direction : null;
  const ariaSort = isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th
      scope="col"
      className={className}
      style={style}
      aria-sort={ariaSort as 'ascending' | 'descending' | 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(columnKey)}
        className={`btn btn-link p-0 text-decoration-none text-reset w-100 text-${align} fw-semibold`}
      >
        <span className="d-inline-flex align-items-center gap-1">
          <span>{label}</span>
          <span
            aria-hidden="true"
            className={`small fw-semibold${isActive ? '' : ' text-muted opacity-50'}`}
          >
            {isActive ? (direction === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </span>
        <span className="visually-hidden">
          {isActive
            ? `Orden ${direction === 'asc' ? 'ascendente' : 'descendente'}. Cambiar orden.`
            : 'Activar orden para esta columna.'}
        </span>
      </button>
    </th>
  );
}
