import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Badge, Button, CloseButton, Form, Modal, Spinner } from 'react-bootstrap';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import type { TableFiltersState } from '../../hooks/useTableFilterState';

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
  multiValue?: boolean;
};

interface FilterToolbarProps {
  filters: FilterDefinition[];
  activeFilters: TableFiltersState;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onFilterChange: (key: string, values: string[]) => void;
  onRemoveFilter: (key: string, value: string) => void;
  onClearAll: () => void;
  resultCount: number;
  isServerBusy?: boolean;
  debounceMs?: number;
  onSaveView?: () => void;
  className?: string;
  renderTrigger?: (options: { open: () => void; hasActiveFilters: boolean; activeCount: number }) => ReactNode;
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
  className,
  renderTrigger,
}: FilterToolbarProps) {
  const [searchDraft, setSearchDraft] = useState(searchValue);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draftValues, setDraftValues] = useState<TableFiltersState>(activeFilters);
  const debouncedSearch = useDebouncedValue(searchDraft, debounceMs);

  useEffect(() => {
    setSearchDraft(searchValue);
  }, [searchValue]);

  useEffect(() => {
    setDraftValues(activeFilters);
  }, [activeFilters]);

  const hasActiveFilters = useMemo(
    () => Object.values(activeFilters).some((values) => values.length > 0),
    [activeFilters],
  );

  const totalActiveFilters = useMemo(
    () => Object.values(activeFilters).reduce((sum, values) => sum + values.length, 0),
    [activeFilters],
  );

  const allFilterKeys = useMemo(() => {
    const keys = new Set<string>();
    filters.forEach((filter) => keys.add(filter.key));
    Object.keys(activeFilters).forEach((key) => keys.add(key));
    return Array.from(keys);
  }, [activeFilters, filters]);

  useEffect(() => {
    if (debouncedSearch === searchValue) return;
    onSearchChange(debouncedSearch);
  }, [debouncedSearch, onSearchChange, searchValue]);

  const handleModalClose = () => {
    setDraftValues(activeFilters);
    setIsModalOpen(false);
  };

  const handleModalApply = () => {
    allFilterKeys.forEach((key) => {
      const values = draftValues[key] ?? [];
      onFilterChange(
        key,
        values.map((value) => value.trim()).filter((value) => value.length > 0),
      );
    });
    setIsModalOpen(false);
  };

  const handleModalClear = () => {
    setDraftValues({});
    onClearAll();
    setIsModalOpen(false);
  };

  const openModal = () => {
    setIsModalOpen(true);
  };

  const triggerNode = renderTrigger
    ? renderTrigger({ open: openModal, hasActiveFilters, activeCount: totalActiveFilters })
    : (
        <Button
          variant={hasActiveFilters ? 'primary' : 'outline-primary'}
          className="fw-semibold d-flex align-items-center gap-2"
          onClick={openModal}
        >
          Filtros
          {totalActiveFilters > 0 ? (
            <Badge bg="light" text="dark" className="rounded-pill px-2 py-1 small fw-semibold">
              {totalActiveFilters}
            </Badge>
          ) : null}
        </Button>
      );

  const renderInput = (filter: FilterDefinition) => {
    const key = filter.key;
    const type = filter.type ?? 'text';
    const currentValues = draftValues[key] ?? [];

    if (type === 'select') {
      const options = filter.options ?? [];
      const multi = filter.multiValue ?? true;
      if (multi) {
        const selected = new Set(currentValues);
        return (
          <div className="d-grid gap-2">
            {options.map((option) => (
              <Form.Check
                key={option.value}
                type="checkbox"
                label={option.label}
                checked={selected.has(option.value)}
                onChange={(event) => {
                  setDraftValues((current) => {
                    const currentList = new Set(current[key] ?? []);
                    if (event.currentTarget.checked) {
                      currentList.add(option.value);
                    } else {
                      currentList.delete(option.value);
                    }
                    return { ...current, [key]: Array.from(currentList) };
                  });
                }}
              />
            ))}
          </div>
        );
      }

      return (
        <Form.Select
          value={currentValues[0] ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setDraftValues((current) => ({ ...current, [key]: value ? [value] : [] }));
          }}
          size="sm"
        >
          <option value="">Selecciona…</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Form.Select>
      );
    }

    const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';
    return (
      <Form.Control
        value={currentValues[0] ?? ''}
        onChange={(event) => {
          const value = event.currentTarget.value;
          setDraftValues((current) => ({ ...current, [key]: value ? [value] : [] }));
        }}
        type={inputType}
        placeholder={filter.placeholder ?? 'Valor'}
        size="sm"
      />
    );
  };

  const appliedFilters = useMemo(() => {
    const definitions = new Map(filters.map((filter) => [filter.key, filter]));
    return Object.entries(activeFilters).flatMap(([key, values]) => {
      if (!values?.length) return [];
      const definition = definitions.get(key);
      const label = definition ? definition.label : key;
      return values.map((value, index) => ({ key, value, label, index }));
    });
  }, [activeFilters, filters]);

  const containerClassName = ['d-flex flex-column gap-3 w-100', className].filter(Boolean).join(' ');

  return (
    <div className={containerClassName}>
      <div className="d-flex flex-wrap align-items-center gap-2">
        {triggerNode}
        <Form.Control
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Buscar…"
          type="search"
          size="sm"
          className="flex-grow-1 flex-md-grow-0"
          style={{ minWidth: 200, maxWidth: 320 }}
        />
        {isServerBusy && <Spinner animation="border" size="sm" role="status" />}
        <Button
          variant="link"
          className="text-decoration-none px-0"
          onClick={onClearAll}
          disabled={!hasActiveFilters && !searchValue.trim().length}
        >
          Borrar filtros
        </Button>
        {onSaveView ? (
          <Button
            variant="outline-secondary"
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
        ) : null}
        <span className="ms-auto small text-muted">
          {resultCount.toLocaleString()} resultado{resultCount === 1 ? '' : 's'}
        </span>
      </div>

      {hasActiveFilters ? (
        <div className="d-flex flex-wrap align-items-center gap-2">
          {appliedFilters.map((item) => (
            <Badge
              key={`${item.key}-${item.value}-${item.index}`}
              bg="light"
              text="dark"
              className="d-flex align-items-center gap-2 py-2 px-3 rounded-pill shadow-sm"
            >
              <span className="small">
                <strong>{item.label}:</strong> {item.value}
              </span>
              <CloseButton
                onClick={() => onRemoveFilter(item.key, item.value)}
                aria-label={`Eliminar filtro ${item.label}`}
              />
            </Badge>
          ))}
        </div>
      ) : null}

      <Modal show={isModalOpen} onHide={handleModalClose} centered size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Filtros</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-grid gap-3">
            {filters.map((filter) => (
              <Form.Group key={filter.key} className="d-grid gap-2">
                <div>
                  <Form.Label className="fw-semibold mb-1">{filter.label}</Form.Label>
                  {filter.description ? (
                    <Form.Text muted className="d-block">
                      {filter.description}
                    </Form.Text>
                  ) : null}
                </div>
                {renderInput(filter)}
              </Form.Group>
            ))}
          </div>
        </Modal.Body>
        <Modal.Footer className="d-flex justify-content-between flex-wrap gap-2">
          <div className="d-flex align-items-center gap-2">
            <Button variant="link" className="text-decoration-none" onClick={handleModalClear}>
              Limpiar todo
            </Button>
          </div>
          <div className="d-flex align-items-center gap-2">
            <Button variant="outline-secondary" onClick={handleModalClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleModalApply}>
              Aplicar filtros
            </Button>
          </div>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
