import { ChangeEvent, forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Badge, Button, CloseButton, Form, Modal, Spinner, Stack } from 'react-bootstrap';
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
  multiple?: boolean;
};

type ActiveFiltersState = Record<string, string[]>;

interface FilterToolbarProps {
  filters: FilterDefinition[];
  activeFilters: ActiveFiltersState;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (key: string, values: string[]) => void;
  onClearAll: () => void;
  resultCount: number;
  isServerBusy?: boolean;
  debounceMs?: number;
  onSaveView?: () => void;
  showTriggerButton?: boolean;
}

function sanitizeDraftFilters(filters: ActiveFiltersState): ActiveFiltersState {
  const sanitized: ActiveFiltersState = {};
  Object.entries(filters).forEach(([key, values]) => {
    const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
    if (normalized.length) {
      sanitized[key] = Array.from(new Set(normalized));
    }
  });
  return sanitized;
}

export function getAppliedFiltersCount(filters: ActiveFiltersState): number {
  return Object.values(filters).reduce((total, values) => total + values.length, 0);
}

export type FilterToolbarHandle = {
  open: () => void;
  close: () => void;
};

export const FilterToolbar = forwardRef<FilterToolbarHandle, FilterToolbarProps>(function FilterToolbar(
  {
    filters,
    activeFilters,
    searchValue,
    onSearchChange,
    onFilterChange,
    onClearAll,
    resultCount,
    isServerBusy = false,
    debounceMs = 200,
    onSaveView,
    showTriggerButton = true,
  },
  ref,
) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<ActiveFiltersState>({});
  const [searchDraft, setSearchDraft] = useState(searchValue);
  const debouncedSearch = useDebouncedValue(searchDraft, debounceMs);

  useImperativeHandle(
    ref,
    () => ({
      open: () => setIsModalOpen(true),
      close: () => setIsModalOpen(false),
    }),
    [],
  );

  useEffect(() => {
    setSearchDraft(searchValue);
  }, [searchValue]);

  useEffect(() => {
    if (!isModalOpen) return;
    setDraftFilters(activeFilters);
  }, [activeFilters, isModalOpen]);

  const optionLabelLookup = useMemo(() => {
    return filters.reduce<Record<string, Map<string, string>>>((acc, filter) => {
      if (!filter.options) return acc;
      acc[filter.key] = new Map(filter.options.map((option) => [option.value, option.label]));
      return acc;
    }, {});
  }, [filters]);

  const hasActiveFilters = useMemo(
    () => getAppliedFiltersCount(activeFilters) > 0,
    [activeFilters],
  );

  useEffect(() => {
    if (debouncedSearch === searchValue) return;
    onSearchChange(debouncedSearch);
  }, [debouncedSearch, onSearchChange, searchValue]);

  const appliedFiltersCount = useMemo(
    () => getAppliedFiltersCount(activeFilters),
    [activeFilters],
  );

  const handleDraftValueChange = (key: string, updater: (current: string[]) => string[]) => {
    setDraftFilters((current) => {
      const nextValues = updater(current[key] ?? []);
      return { ...current, [key]: nextValues };
    });
  };

  const handleDraftInputChange = (key: string) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    handleDraftValueChange(key, () => (value.trim().length ? [value] : []));
  };

  const handleDraftSelectChange = (key: string, value: string, checked: boolean) => {
    handleDraftValueChange(key, (current) => {
      const set = new Set(current);
      if (checked) {
        set.add(value);
      } else {
        set.delete(value);
      }
      return Array.from(set);
    });
  };

  const handleApplyFilters = () => {
    const sanitized = sanitizeDraftFilters(draftFilters);
    const keys = new Set<string>([...Object.keys(activeFilters), ...Object.keys(sanitized)]);
    keys.forEach((key) => {
      const values = sanitized[key] ?? [];
      onFilterChange(key, values);
    });
    setIsModalOpen(false);
  };

  const handleRemoveValue = (key: string, value: string) => {
    const currentValues = activeFilters[key] ?? [];
    const nextValues = currentValues.filter((item) => item !== value);
    onFilterChange(key, nextValues);
  };

  const handleClearDraft = () => {
    setDraftFilters({});
  };

  return (
    <div className="d-flex flex-column gap-2">
      <div className="d-flex flex-wrap align-items-center gap-2">
        <div className="d-flex align-items-center gap-2">
          <Form.Control
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Buscar..."
            style={{ minWidth: 200 }}
            size="sm"
          />
          {isServerBusy && <Spinner animation="border" size="sm" role="status" />}
        </div>
        {showTriggerButton && (
          <Button
            variant="outline-primary"
            className="d-flex align-items-center gap-2"
            onClick={() => setIsModalOpen(true)}
          >
            <span>Filtros</span>
            {appliedFiltersCount > 0 && (
              <Badge bg="primary" pill>
                {appliedFiltersCount}
              </Badge>
            )}
          </Button>
        )}
        <Button
          variant="outline-secondary"
          onClick={onClearAll}
          disabled={!hasActiveFilters && !searchValue.trim().length}
        >
          Borrar filtros
        </Button>
        {onSaveView && (
          <Button
            variant="outline-secondary"
            onClick={() => {
              if (onSaveView) {
                onSaveView();
              }
            }}
          >
            Guardar vista
          </Button>
        )}
        <div className="ms-auto text-muted small fw-semibold">
          {resultCount.toLocaleString()} resultados
        </div>
      </div>

      {hasActiveFilters ? (
        <div className="d-flex flex-wrap gap-2">
          {Object.entries(activeFilters).map(([key, values]) => {
            if (!values.length) return null;
            const definition = filters.find((filter) => filter.key === key);
            const label = definition ? definition.label : key;
            return values.map((value) => {
              const optionLabel = optionLabelLookup[key]?.get(value);
              const displayValue = optionLabel ?? value;
              return (
                <Badge key={`${key}-${value}`} bg="primary" className="d-flex align-items-center gap-2">
                  <span>
                    {label}: <strong>{displayValue}</strong>
                  </span>
                  <CloseButton
                    variant="white"
                    onClick={() => handleRemoveValue(key, value)}
                    aria-label={`Eliminar filtro ${label} ${displayValue}`}
                  />
                </Badge>
              );
            });
          })}
        </div>
      ) : null}

      <Modal show={isModalOpen} onHide={() => setIsModalOpen(false)} centered size="lg" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Filtros</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-grid gap-3">
            {filters.map((filter) => {
              const values = draftFilters[filter.key] ?? [];
              const firstValue = values[0] ?? '';
              const inputId = `filter-${filter.key}`;
              const type = filter.type ?? 'text';
              const multiple = filter.multiple ?? true;

              return (
                <Form.Group key={filter.key} controlId={inputId}>
                  <div className="d-flex justify-content-between align-items-start gap-2 mb-1">
                    <Form.Label className="mb-0">{filter.label}</Form.Label>
                    {filter.description ? (
                      <small className="text-muted">{filter.description}</small>
                    ) : null}
                  </div>
                  {filter.options && filter.options.length ? (
                    <Stack direction="horizontal" gap={2} className="flex-wrap">
                      {filter.options.map((option) => {
                        const optionId = `${inputId}-${option.value}`;
                        const checked = values.includes(option.value);
                        return (
                          <Form.Check
                            key={option.value}
                            id={optionId}
                            type={multiple ? 'checkbox' : 'radio'}
                            name={multiple ? optionId : filter.key}
                            label={option.label}
                            checked={checked}
                            onChange={(event) =>
                              handleDraftSelectChange(filter.key, option.value, event.target.checked)
                            }
                          />
                        );
                      })}
                    </Stack>
                  ) : (
                    <Form.Control
                      value={firstValue}
                      onChange={handleDraftInputChange(filter.key)}
                      type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
                      placeholder={filter.placeholder ?? 'Introduce un valor'}
                    />
                  )}
                </Form.Group>
              );
            })}
          </div>
        </Modal.Body>
        <Modal.Footer className="justify-content-between">
          <Button variant="link" onClick={handleClearDraft} className="text-decoration-none">
            Limpiar selección
          </Button>
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleApplyFilters}>
              Aplicar filtros
            </Button>
          </div>
        </Modal.Footer>
      </Modal>
    </div>
  );
});
