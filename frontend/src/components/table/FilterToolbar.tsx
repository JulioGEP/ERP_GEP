import { useCallback, useEffect, useMemo, useState, useId, useRef } from 'react';
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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type SavedFilterView = {
  id: string;
  name: string;
  filters: Record<string, string>;
  searchValue: string;
  createdAt: number;
  lastAccessedAt: number;
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
  viewStorageKey?: string;
  onApplyFilterState?: (state: { filters: Record<string, string>; searchValue: string }) => void;
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
  resultCount: _resultCount,
  isServerBusy = false,
  viewStorageKey,
  onApplyFilterState,
}: FilterToolbarProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState<Record<string, string>>({});
  const [searchDraft, setSearchDraft] = useState(searchValue);
  const [savedViews, setSavedViews] = useState<SavedFilterView[]>([]);
  const [optionSearchTerms, setOptionSearchTerms] = useState<Record<string, string>>({});
  const [openSelectKey, setOpenSelectKey] = useState<string | null>(null);
  const [isSavedViewsOpen, setIsSavedViewsOpen] = useState(false);
  const idPrefix = useId();
  const storageKey = viewStorageKey ? `filter-toolbar:${viewStorageKey}` : null;
  const selectRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const savedViewsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSearchDraft(searchValue);
  }, [searchValue]);

  const persistSavedViews = useCallback(
    (views: SavedFilterView[]) => {
      if (!storageKey || typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(views));
      } catch {
        // ignorar errores de almacenamiento (p. ej. cuota superada)
      }
    },
    [storageKey],
  );

  useEffect(() => {
    if (!storageKey) {
      setSavedViews([]);
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setSavedViews([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setSavedViews([]);
        return;
      }
      const normalized = parsed
        .map((item: unknown) => {
          if (!item || typeof item !== 'object') return null;
          const candidate = item as Partial<SavedFilterView> & {
            filters?: Record<string, unknown>;
          };
          const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
          const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
          if (!id.length || !name.length) return null;
          const rawFilters = candidate.filters ?? {};
          const filters: Record<string, string> = {};
          Object.entries(rawFilters).forEach(([key, value]) => {
            if (typeof value === 'string' && value.trim().length) {
              filters[key] = value;
            }
          });
          const search = typeof candidate.searchValue === 'string' ? candidate.searchValue : '';
          const createdAt =
            typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
              ? candidate.createdAt
              : Date.now();
          const lastAccessedAt =
            typeof candidate.lastAccessedAt === 'number' &&
            Number.isFinite(candidate.lastAccessedAt)
              ? candidate.lastAccessedAt
              : createdAt;
          return {
            id,
            name,
            filters,
            searchValue: search,
            createdAt,
            lastAccessedAt,
          } satisfies SavedFilterView;
        })
        .filter((item): item is SavedFilterView => Boolean(item));
      const now = Date.now();
      const active = normalized.filter((view) => now - view.lastAccessedAt <= THIRTY_DAYS_MS);
      if (active.length !== normalized.length) {
        persistSavedViews(active);
      }
      active.sort((a, b) => {
        const byName = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
        if (byName !== 0) return byName;
        return a.createdAt - b.createdAt;
      });
      setSavedViews(active);
    } catch {
      setSavedViews([]);
    }
  }, [persistSavedViews, storageKey]);

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
    setOptionSearchTerms({});
    setOpenSelectKey(null);
    setIsSavedViewsOpen(false);
    setIsModalOpen(true);
  }, [activeFilters, searchValue]);

  const handleModalClose = useCallback(() => {
    setOpenSelectKey(null);
    setIsSavedViewsOpen(false);
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

  const handleSelectInputChange = useCallback((key: string, displayValue: string) => {
    const parts = displayValue
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    setDraftFilters((current) => {
      if (!parts.length) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: joinFilterValues(parts) };
    });
  }, []);

  const handleOptionSearchChange = useCallback((key: string, query: string) => {
    setOptionSearchTerms((current) => {
      if (!query.length) {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: query };
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
    setOpenSelectKey(null);
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
    setOpenSelectKey(null);
  }, [onClearAll]);

  const handleSaveCurrentView = useCallback(() => {
    if (!storageKey || typeof window === 'undefined') {
      return;
    }

    const proposedName = window.prompt('Introduce el nombre de la vista guardada');
    if (proposedName === null) {
      return;
    }
    const trimmedName = proposedName.trim();
    if (!trimmedName.length) {
      return;
    }

    const normalizedFilters = filters.reduce<Record<string, string>>((acc, definition) => {
      const rawValue = draftFilters[definition.key] ?? '';
      const normalized = definition.type === 'select' ? rawValue : rawValue.trim();
      if (normalized.length) {
        acc[definition.key] = normalized;
      }
      return acc;
    }, {});
    const normalizedSearch = searchDraft.trim();

    const existing = savedViews.find(
      (view) => view.name.localeCompare(trimmedName, 'es', { sensitivity: 'base' }) === 0,
    );
    if (existing) {
      const shouldReplace = window.confirm(
        `Ya existe una vista llamada "${existing.name}". ¿Quieres reemplazarla?`,
      );
      if (!shouldReplace) {
        return;
      }
    }

    const viewId =
      existing?.id ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}`);
    const createdAt = existing?.createdAt ?? Date.now();
    const lastAccessedAt = Date.now();

    const nextView: SavedFilterView = {
      id: viewId,
      name: trimmedName,
      filters: normalizedFilters,
      searchValue: normalizedSearch,
      createdAt,
      lastAccessedAt,
    };

    setSavedViews((current) => {
      const updated = existing
        ? current.map((view) => (view.id === existing.id ? nextView : view))
        : [...current, nextView];
      updated.sort((a, b) => {
        const byName = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
        if (byName !== 0) return byName;
        return a.createdAt - b.createdAt;
      });
      persistSavedViews(updated);
      return updated;
    });

    setIsModalOpen(false);
    setOpenSelectKey(null);
  }, [
    draftFilters,
    filters,
    persistSavedViews,
    savedViews,
    searchDraft,
    storageKey,
  ]);

  const handleApplySavedView = useCallback(
    (view: SavedFilterView) => {
      const normalizedFilters = view.filters ?? {};
      const normalizedSearch = view.searchValue ?? '';
      const allowedKeys = new Set(filters.map((definition) => definition.key));
      const filteredFilters = Object.entries(normalizedFilters).reduce<Record<string, string>>(
        (acc, [key, value]) => {
          if (!allowedKeys.has(key)) return acc;
          acc[key] = value;
          return acc;
        },
        {},
      );

      if (onApplyFilterState) {
        onApplyFilterState({ filters: filteredFilters, searchValue: normalizedSearch });
      } else {
        Object.keys(activeFilters).forEach((key) => {
          if (!allowedKeys.has(key)) return;
          if (!(key in filteredFilters)) {
            onRemoveFilter(key);
          }
        });

        Object.entries(filteredFilters).forEach(([key, value]) => {
          onFilterChange(key, value);
        });

        onSearchChange(normalizedSearch);
      }

      setDraftFilters({ ...normalizedFilters });
      setSearchDraft(normalizedSearch);
      setIsModalOpen(false);
      setIsSavedViewsOpen(false);
      setOpenSelectKey(null);
      setSavedViews((current) => {
        const now = Date.now();
        const updated = current.map((candidate) =>
          candidate.id === view.id
            ? { ...candidate, lastAccessedAt: now }
            : candidate,
        );
        persistSavedViews(updated);
        return updated;
      });
    },
    [
      activeFilters,
      filters,
      onApplyFilterState,
      onFilterChange,
      onRemoveFilter,
      onSearchChange,
      persistSavedViews,
    ],
  );

  const handleDeleteSavedView = useCallback(
    (id: string) => {
      if (!storageKey || typeof window === 'undefined') {
        return;
      }

      const target = savedViews.find((view) => view.id === id);
      const confirmationMessage = target
        ? `¿Eliminar la vista "${target.name}"?`
        : '¿Eliminar la vista guardada?';
      const confirmed = window.confirm(confirmationMessage);
      if (!confirmed) {
        return;
      }

      setSavedViews((current) => {
        const updated = current.filter((view) => view.id !== id);
        persistSavedViews(updated);
        return updated;
      });
    },
    [persistSavedViews, savedViews, storageKey],
  );

  const canSaveViews = Boolean(storageKey);
  const hasSavedViews = savedViews.length > 0;
  const shouldDisplaySavedViewsControl = canSaveViews || hasSavedViews;

  useEffect(() => {
    if (!openSelectKey) return;

    const handleClickOutside = (event: MouseEvent) => {
      const container = selectRefs.current[openSelectKey];
      if (container && container.contains(event.target as Node)) {
        return;
      }
      setOpenSelectKey(null);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openSelectKey]);

  useEffect(() => {
    if (!isSavedViewsOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const container = savedViewsRef.current;
      if (container && container.contains(event.target as Node)) {
        return;
      }
      setIsSavedViewsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isSavedViewsOpen]);

  useEffect(() => {
    if (!shouldDisplaySavedViewsControl) {
      setIsSavedViewsOpen(false);
    }
  }, [shouldDisplaySavedViewsControl]);

  return (
    <>
      <div className="d-flex flex-column gap-2">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <Button variant="outline-primary" onClick={handleModalOpen} className="fw-semibold">
            Filtros
          </Button>
          {isServerBusy && <Spinner animation="border" size="sm" role="status" />}
          {shouldDisplaySavedViewsControl && (
            <div className="position-relative" ref={savedViewsRef}>
              <Button
                variant="outline-secondary"
                onClick={() => setIsSavedViewsOpen((previous) => !previous)}
                className="fw-semibold"
              >
                Vistas guardadas
              </Button>
              {isSavedViewsOpen && (
                <div
                  className="position-absolute mt-2 bg-white border rounded shadow-sm"
                  style={{ zIndex: 1060, minWidth: '240px' }}
                >
                  <div className="list-group list-group-flush">
                    {hasSavedViews ? (
                      savedViews.map((view) => (
                        <div
                          role="button"
                          tabIndex={0}
                          key={view.id}
                          className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                          onClick={() => handleApplySavedView(view)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleApplySavedView(view);
                            }
                          }}
                        >
                          <span className="text-start">{view.name}</span>
                          {canSaveViews && (
                            <button
                              type="button"
                              className="btn btn-link p-0 text-danger"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleDeleteSavedView(view.id);
                              }}
                              aria-label={`Eliminar vista ${view.name}`}
                              style={{ textDecoration: 'none' }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="list-group-item text-muted small">
                        No hay vistas guardadas.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
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
        </div>
      </div>

      <Modal show={isModalOpen} onHide={handleModalClose} size="lg" centered>
        <Modal.Header closeButton closeVariant="white" className="bg-danger text-white">
          <Modal.Title className="text-white">Filtros</Modal.Title>
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
                  const options = definition.options ?? [];
                  const selected = new Set(splitFilterValue(draftFilters[definition.key]));
                  const displayValue = Array.from(selected).join(', ');
                  const query = optionSearchTerms[definition.key] ?? '';
                  const normalizedQuery = query.trim().toLocaleLowerCase('es-ES');
                  const filteredOptions = normalizedQuery.length
                    ? options.filter((option) =>
                        option.label.toLocaleLowerCase('es-ES').includes(normalizedQuery),
                      )
                    : options;

                  const isOpen = openSelectKey === definition.key;
                  return (
                    <Col xs={12} lg={4} key={definition.key}>
                      <div
                        ref={(node) => {
                          if (node) {
                            selectRefs.current[definition.key] = node;
                          } else {
                            delete selectRefs.current[definition.key];
                          }
                        }}
                      >
                        <Form.Group controlId={controlId}>
                          <Form.Label className="d-block">
                            {definition.label}
                            {definition.description && (
                              <span className="d-block text-muted small">{definition.description}</span>
                            )}
                          </Form.Label>
                          <Form.Control
                            type="text"
                            value={displayValue}
                            onFocus={() => setOpenSelectKey(definition.key)}
                            onClick={() => setOpenSelectKey(definition.key)}
                            onChange={(event) =>
                              handleSelectInputChange(definition.key, event.target.value)
                            }
                            placeholder={
                              definition.placeholder ??
                              'Escribe valores separados por comas para filtrar'
                            }
                          />
                          {isOpen && (
                            <div className="border rounded mt-2 p-3 bg-white shadow-sm">
                              <Form.Control
                                type="search"
                                value={query}
                                onChange={(event) =>
                                  handleOptionSearchChange(definition.key, event.target.value)
                                }
                                placeholder="Filtrar opciones"
                                className="mb-3"
                              />
                              {options.length ? (
                                filteredOptions.length ? (
                                  <div
                                    className="d-grid gap-2"
                                    style={{ maxHeight: '200px', overflowY: 'auto' }}
                                  >
                                    {filteredOptions.map((option) => {
                                      const optionId = `${controlId}-${option.value}`;
                                      return (
                                        <Form.Check
                                          type="checkbox"
                                          id={optionId}
                                          key={option.value}
                                          label={option.label}
                                          checked={selected.has(option.value)}
                                          onChange={() =>
                                            handleToggleOption(definition.key, option.value)
                                          }
                                        />
                                      );
                                    })}
                                  </div>
                                ) : (
                                  <p className="text-muted small mb-0">
                                    No hay coincidencias para ese término.
                                  </p>
                                )
                              ) : (
                                <p className="text-muted small mb-0">No hay opciones disponibles.</p>
                              )}
                            </div>
                          )}
                        </Form.Group>
                      </div>
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
            {canSaveViews && (
              <Button variant="outline-primary" onClick={handleSaveCurrentView}>
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
