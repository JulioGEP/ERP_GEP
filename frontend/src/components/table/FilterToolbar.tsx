import { useCallback, useEffect, useMemo, useState, useId } from 'react';
import { Badge, Button, Col, Form, Modal, Row, Spinner } from 'react-bootstrap';
import { joinFilterValues, splitFilterValue } from './filterUtils';

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

type BadgeDescriptor = {
  id: string;
  label: string;
  value: string;
  onRemove: () => void;
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
  debounceMs?: number; // mantenido por compatibilidad, no se usa directamente
  onSaveView?: () => void;
}

function formatFilterValue(
  definition: FilterDefinition | undefined,
  rawValue: string,
): string | string[] {
  if (!definition) return rawValue;
  if (definition.type === 'select' && definition.options) {
    const selected = splitFilterValue(rawValue);
    const labels = definition.options.reduce<Record<string, string>>((map, option) => {
      map[option.value] = option.label;
      return map;
    }, {});
    return selected.map((value) => labels[value] ?? value);
  }
  if (definition.type === 'date') {
    try {
      const date = new Date(rawValue);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleDateString('es-ES');
      }
    } catch {
      // ignorar errores de formato
    }
  }
  return rawValue;
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
  onSaveView,
}: FilterToolbarProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<Record<string, string>>({});
  const [searchDraft, setSearchDraft] = useState(searchValue);
  const idPrefix = useId();

  useEffect(() => {
    setSearchDraft(searchValue);
  }, [searchValue]);

  const filterMap = useMemo(() => {
    const map = new Map<string, FilterDefinition>();
    filters.forEach((definition) => {
      map.set(definition.key, definition);
    });
    return map;
  }, [filters]);

  const appliedBadges = useMemo<BadgeDescriptor[]>(() => {
    const items: BadgeDescriptor[] = [];

    const normalizedSearch = searchValue.trim();
    if (normalizedSearch.length) {
      items.push({
        id: '__search',
        label: 'Buscar',
        value: normalizedSearch,
        onRemove: () => onSearchChange(''),
      });
    }

    Object.entries(activeFilters).forEach(([key, rawValue]) => {
      const definition = filterMap.get(key);
      if (!rawValue || !rawValue.trim().length) return;
      if (definition?.type === 'select') {
        const rawParts = splitFilterValue(rawValue);
        const formatted = formatFilterValue(definition, rawValue);
        const displayParts = Array.isArray(formatted) ? formatted : rawParts;
        rawParts.forEach((rawPart, index) => {
          const displayValue = displayParts[index] ?? rawPart;
          const badgeId = `${key}-${rawPart}-${index}`;
          items.push({
            id: badgeId,
            label: definition?.label ?? key,
            value: displayValue,
            onRemove: () => {
              const remaining = rawParts.filter((_, rawIndex) => rawIndex !== index);
              if (remaining.length) {
                onFilterChange(key, joinFilterValues(remaining));
              } else {
                onRemoveFilter(key);
              }
            },
          });
        });
        return;
      }

      const formatted = formatFilterValue(definition, rawValue);
      const displayValue = Array.isArray(formatted) ? formatted.join(', ') : formatted;
      items.push({
        id: key,
        label: definition?.label ?? key,
        value: displayValue,
        onRemove: () => onRemoveFilter(key),
      });
    });

    return items;
  }, [activeFilters, filterMap, onFilterChange, onRemoveFilter, onSearchChange, searchValue]);

  const handleModalOpen = useCallback(() => {
    setDraftFilters({ ...activeFilters });
    setSearchDraft(searchValue);
    setIsModalOpen(true);
  }, [activeFilters, searchValue]);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleToggleOption = useCallback((key: string, optionValue: string) => {
    setDraftFilters((current) => {
      const selected = new Set(splitFilterValue(current[key]));
      if (selected.has(optionValue)) {
        selected.delete(optionValue);
      } else {
        selected.add(optionValue);
      }
      const nextValue = joinFilterValues(selected);
      if (!nextValue.length) {
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: nextValue };
    });
  }, []);

  const handleDraftChange = useCallback((key: string, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const handleApply = useCallback(() => {
    const trimmedSearch = searchDraft.trim();
    if (trimmedSearch !== searchValue.trim()) {
      onSearchChange(trimmedSearch);
    }

    filters.forEach((definition) => {
      const raw = draftFilters[definition.key] ?? '';
      const normalized = definition.type === 'select' ? raw : raw.trim();
      if (normalized.length) {
        if (activeFilters[definition.key] !== normalized) {
          onFilterChange(definition.key, normalized);
        }
      } else if (activeFilters[definition.key]) {
        onRemoveFilter(definition.key);
      }
    });

    setIsModalOpen(false);
  }, [
    activeFilters,
    draftFilters,
    filters,
    onFilterChange,
    onRemoveFilter,
    onSearchChange,
    searchDraft,
    searchValue,
  ]);

  const handleClearAll = useCallback(() => {
    setDraftFilters({});
    setSearchDraft('');
    onClearAll();
    setIsModalOpen(false);
  }, [onClearAll]);

  const resultLabel = useMemo(() => {
    const count = Number.isFinite(resultCount) ? resultCount : 0;
    return `${count.toLocaleString('es-ES')} resultado${count === 1 ? '' : 's'}`;
  }, [resultCount]);

  const hasAppliedFilters = appliedBadges.length > 0;

  return (
    <>
      <div className="d-flex flex-column gap-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Button variant="outline-primary" onClick={handleModalOpen} className="fw-semibold">
            Filtros
          </Button>
          <span className="text-muted small">{resultLabel}</span>
          {isServerBusy && <Spinner animation="border" size="sm" role="status" />}
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          {appliedBadges.map((badge) => (
            <Badge
              key={badge.id}
              bg="light"
              text="dark"
              className="d-inline-flex align-items-center gap-2 border border-primary text-primary px-2 py-1"
            >
              <span>
                <span className="fw-semibold me-1">{badge.label}:</span>
                {badge.value}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-link text-primary p-0 border-0"
                onClick={badge.onRemove}
                aria-label={`Eliminar filtro ${badge.label}`}
                style={{ textDecoration: 'none' }}
              >
                ×
              </button>
            </Badge>
          ))}
          {!hasAppliedFilters && (
            <span className="text-muted small">Sin filtros aplicados</span>
          )}
        </div>
      </div>

      <Modal show={isModalOpen} onHide={handleModalClose} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>Filtros</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Row className="g-4">
              <Col xs={12} lg={4}>
                <Form.Group controlId={`${idPrefix}-search`}>
                  <Form.Label>Búsqueda global</Form.Label>
                  <Form.Control
                    type="text"
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    placeholder="Buscar en la tabla..."
                  />
                </Form.Group>
              </Col>

              {filters.map((definition) => {
                const controlId = `${idPrefix}-${definition.key}`;
                if (definition.type === 'select') {
                  const selected = new Set(splitFilterValue(draftFilters[definition.key]));
                  const options = definition.options ?? [];
                  return (
                    <Col xs={12} lg={4} key={definition.key}>
                      <Form.Group controlId={controlId}>
                        <Form.Label className="d-block">
                          {definition.label}
                          {definition.description && (
                            <span className="d-block text-muted small">{definition.description}</span>
                          )}
                        </Form.Label>
                        {options.length ? (
                          <div className="d-grid gap-2">
                            {options.map((option) => {
                              const optionId = `${controlId}-${option.value}`;
                              return (
                                <Form.Check
                                  type="checkbox"
                                  id={optionId}
                                  key={option.value}
                                  label={option.label}
                                  checked={selected.has(option.value)}
                                  onChange={() => handleToggleOption(definition.key, option.value)}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-muted small mb-0">No hay opciones disponibles.</p>
                        )}
                      </Form.Group>
                    </Col>
                  );
                }

                const inputType = definition.type === 'number'
                  ? 'number'
                  : definition.type === 'date'
                  ? 'date'
                  : 'text';

                return (
                  <Col xs={12} lg={4} key={definition.key}>
                    <Form.Group controlId={controlId}>
                      <Form.Label className="d-block">
                        {definition.label}
                        {definition.description && (
                          <span className="d-block text-muted small">{definition.description}</span>
                        )}
                      </Form.Label>
                      <Form.Control
                        type={inputType}
                        value={draftFilters[definition.key] ?? ''}
                        onChange={(event) => handleDraftChange(definition.key, event.target.value)}
                        placeholder={definition.placeholder ?? 'Introduce un valor'}
                      />
                    </Form.Group>
                  </Col>
                );
              })}
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer className="d-flex flex-column flex-lg-row align-items-stretch align-items-lg-center justify-content-between gap-2">
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" onClick={handleClearAll}>
              Limpiar todo
            </Button>
            {onSaveView && (
              <Button variant="outline-primary" onClick={onSaveView}>
                Guardar vista
              </Button>
            )}
          </div>
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" onClick={handleModalClose}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={handleApply}>
              Aplicar filtros
            </Button>
          </div>
        </Modal.Footer>
      </Modal>
    </>
  );
}
