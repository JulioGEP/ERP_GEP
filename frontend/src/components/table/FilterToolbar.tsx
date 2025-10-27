import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Form, Spinner } from 'react-bootstrap';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';

export type FilterInputType = 'text' | 'number' | 'select' | 'date';

export type FilterOption = {
  value: string;
  label: string;
};

export type FilterDefinition = {
  key: string;
  label: string;
  description?: string;
  type?: FilterInputType;
  options?: FilterOption[];
  placeholder?: string;
};

interface FilterToolbarProps {
  filters: FilterDefinition[];
  activeFilters: Record<string, string>;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (key: string, value: string) => void;
  onRemoveFilter: (key: string) => void;
  onClearAll: () => void;
  resultCount: number;
  isServerBusy?: boolean;
  debounceMs?: number;
  onSaveView?: () => void;
}

export function FilterToolbar({
  filters,
  activeFilters,
  searchValue,
  onSearchChange,
  onFilterChange,
  onRemoveFilter,
  onClearAll,
  resultCount,
  isServerBusy = false,
  debounceMs = 200,
  onSaveView,
}: FilterToolbarProps) {
  const [selectedFilterKey, setSelectedFilterKey] = useState('');
  const [pendingValue, setPendingValue] = useState('');
  const [searchDraft, setSearchDraft] = useState(searchValue);
  const debouncedSearch = useDebouncedValue(searchDraft, debounceMs);

  useEffect(() => {
    setSearchDraft(searchValue);
  }, [searchValue]);

  const hasActiveFilters = useMemo(
    () => Object.keys(activeFilters).length > 0,
    [activeFilters],
  );

  const selectedFilter = useMemo(
    () => filters.find((filter) => filter.key === selectedFilterKey) ?? null,
    [filters, selectedFilterKey],
  );

  useEffect(() => {
    if (debouncedSearch === searchValue) return;
    onSearchChange(debouncedSearch);
  }, [debouncedSearch, onSearchChange, searchValue]);

  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFilter) return;
    const value = pendingValue.trim();
    onFilterChange(selectedFilter.key, value);
    setPendingValue('');
  };

  return (
    <div className="d-grid gap-3">
      <div className="d-flex flex-column flex-lg-row gap-3 align-items-lg-center justify-content-between">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Form.Control
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Buscar..."
            style={{ minWidth: 240 }}
          />
          {isServerBusy && <Spinner animation="border" size="sm" role="status" />}
        </div>
        <div className="d-flex gap-2">
          <Button
            variant="outline-secondary"
            onClick={onClearAll}
            disabled={!hasActiveFilters && !searchValue.trim().length}
          >
            Borrar filtros
          </Button>
          <Button
            variant="outline-primary"
            onClick={() => {
              if (onSaveView) {
                onSaveView();
              } else {
                console.info('Guardar vista no implementado');
              }
            }}
          >
            Guardar vista
          </Button>
        </div>
      </div>

      <div className="d-flex flex-column flex-lg-row align-items-lg-center justify-content-between gap-3">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <strong>{resultCount.toLocaleString()} resultados</strong>
          {Object.entries(activeFilters).map(([key, value]) => {
            const definition = filters.find((filter) => filter.key === key);
            const label = definition ? definition.label : key;
            return (
              <Badge key={key} bg="primary" className="d-flex align-items-center gap-2">
                <span>
                  {label}: <strong>{value}</strong>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-link text-white p-0 border-0"
                  onClick={() => onRemoveFilter(key)}
                  aria-label={`Eliminar filtro ${label}`}
                  style={{ textDecoration: 'none' }}
                >
                  ×
                </button>
              </Badge>
            );
          })}
        </div>
        <Form className="d-flex flex-wrap gap-2 align-items-center" onSubmit={handleFilterSubmit}>
          <Form.Select
            value={selectedFilterKey}
            onChange={(event) => {
              setSelectedFilterKey(event.target.value);
              setPendingValue('');
            }}
            style={{ minWidth: 200 }}
          >
            <option value="">Añadir filtro…</option>
            {filters.map((filter) => (
              <option key={filter.key} value={filter.key}>
                {filter.label}
              </option>
            ))}
          </Form.Select>
          {selectedFilter && selectedFilter.type === 'select' ? (
            <Form.Select
              value={pendingValue}
              onChange={(event) => setPendingValue(event.target.value)}
              style={{ minWidth: 200 }}
            >
              <option value="">Selecciona…</option>
              {selectedFilter.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Form.Select>
          ) : (
            <Form.Control
              value={pendingValue}
              onChange={(event) => setPendingValue(event.target.value)}
              type={selectedFilter?.type === 'number' ? 'number' : selectedFilter?.type === 'date' ? 'date' : 'text'}
              placeholder={selectedFilter?.placeholder ?? 'Valor'}
              style={{ minWidth: 200 }}
            />
          )}
          <Button type="submit" variant="secondary" disabled={!selectedFilter}>
            Aplicar
          </Button>
        </Form>
      </div>
    </div>
  );
}
