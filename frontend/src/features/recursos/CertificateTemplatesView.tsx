import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Row,
  Spinner,
} from 'react-bootstrap';

import {
  getTrainingTemplatesManager,
  type TrainingTemplate,
  type TrainingTemplateInput,
  type TrainingTemplatesManager,
} from '../certificados/lib/templates/training-templates';
import type { Product } from '../../types/product';
import { fetchProducts } from './products.api';

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type CertificateTemplatesViewProps = {
  onNotify: (toast: ToastParams) => void;
};

type TrainingTemplatesApi = TrainingTemplatesManager;

type TemplateFormState = {
  id: string;
  name: string;
  title: string;
  duration: string;
  theoryPoints: string[];
  practicePoints: string[];
  persistId: boolean;
  isCustom: boolean;
};

function resolveProductLabel(product: Product): string {
  const candidates = [product.name, product.code, product.id_pipe, product.id];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return product.id;
}

function normaliseTemplateKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function extractTemplateTokens(value: string): string[] {
  return value
    .split(/[;,|\n]+/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }
  return 'Se ha producido un error inesperado.';
}

function normaliseListEntries(entries: string[]): string[] {
  return entries.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function getTrainingTemplatesApi(): TrainingTemplatesApi {
  const api = getTrainingTemplatesManager();
  if (!api) {
    throw new Error('El gestor de plantillas no está disponible.');
  }
  return api;
}

function mapTemplateToFormState(template: TrainingTemplate, api: TrainingTemplatesApi): TemplateFormState {
  const isCustom = Boolean(api.isCustomTemplateId?.(template.id));
  const hasPersistableId = Boolean(template.id?.trim?.());
  return {
    id: template.id ?? '',
    name: template.name ?? '',
    title: template.title ?? '',
    duration: template.duration ?? '',
    theoryPoints: Array.isArray(template.theory)
      ? template.theory.map((entry) => entry?.trim?.()).filter((entry): entry is string => Boolean(entry))
      : [],
    practicePoints: Array.isArray(template.practice)
      ? template.practice.map((entry) => entry?.trim?.()).filter((entry): entry is string => Boolean(entry))
      : [],
    persistId: hasPersistableId,
    isCustom,
  };
}

function buildEmptyFormState(api: TrainingTemplatesApi): TemplateFormState {
  const empty = api.createEmptyTemplate();
  return {
    id: empty.id ?? '',
    name: empty.name ?? '',
    title: empty.title ?? '',
    duration: empty.duration ?? '',
    theoryPoints: [],
    practicePoints: [],
    persistId: false,
    isCustom: true,
  };
}

function buildPayloadFromState(
  state: TemplateFormState,
  overrides: Partial<TrainingTemplateInput> = {}
): TrainingTemplateInput {
  const trimmedId = state.id?.trim?.() ?? '';
  const base: TrainingTemplateInput = {
    id: state.persistId && trimmedId ? trimmedId : undefined,
    name: state.name.trim(),
    title: state.title.trim(),
    duration: state.duration.trim(),
    theory: normaliseListEntries(state.theoryPoints),
    practice: normaliseListEntries(state.practicePoints),
  };

  const payload: TrainingTemplateInput = {
    ...base,
    ...overrides,
  };

  if (typeof payload.name === 'string') {
    payload.name = payload.name.trim();
  }
  if (typeof payload.title === 'string') {
    payload.title = payload.title.trim();
  }
  if (typeof payload.duration === 'string') {
    payload.duration = payload.duration.trim();
  }

  return payload;
}

export function CertificateTemplatesView({ onNotify }: CertificateTemplatesViewProps) {
  const [templates, setTemplates] = useState<TrainingTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [formState, setFormState] = useState<TemplateFormState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [initialisationError, setInitialisationError] = useState<string | null>(null);
  const productsQuery = useQuery({
    queryKey: ['products'],
    queryFn: fetchProducts,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const initialise = async () => {
      try {
        const api = getTrainingTemplatesApi();
        const list = await api.listTemplates();
        if (cancelled) {
          return;
        }
        setTemplates(list);
        if (list.length > 0) {
          const initial = list[0];
          setSelectedTemplateId(initial.id);
          setFormState(mapTemplateToFormState(initial, api));
        }

        if (typeof api.subscribe === 'function') {
          unsubscribe = api.subscribe(async () => {
            try {
              const updatedTemplates = await api.listTemplates();
              if (!cancelled) {
                setTemplates(updatedTemplates);
              }
            } catch (subscriptionError) {
              console.warn('No se pudieron actualizar las plantillas', subscriptionError);
            }
          });
        }
      } catch (error) {
        if (!cancelled) {
          setInitialisationError(resolveErrorMessage(error));
        }
      }
    };

    void initialise();

    return () => {
      cancelled = true;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedTemplateId) {
      return;
    }

    try {
      const api = getTrainingTemplatesApi();
      const selected = templates.find((template) => template.id === selectedTemplateId);
      if (selected) {
        setFormState(mapTemplateToFormState(selected, api));
      }
    } catch (error) {
      setInitialisationError((current) => current ?? resolveErrorMessage(error));
    }
  }, [selectedTemplateId, templates]);

  const api = useMemo(() => {
    try {
      return getTrainingTemplatesApi();
    } catch {
      return null;
    }
  }, []);

  const handleCreateTemplate = useCallback(() => {
    if (!api) {
      return;
    }
    setSelectedTemplateId('');
    setFormState(buildEmptyFormState(api));
  }, [api]);

  const handleTemplateSelectionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      if (!value) {
        setSelectedTemplateId('');
        if (api) {
          setFormState(buildEmptyFormState(api));
        }
        return;
      }
      setSelectedTemplateId(value);
    },
    [api]
  );

  const handleFormChange = useCallback(
    <Field extends keyof TemplateFormState>(field: Field, value: TemplateFormState[Field]) => {
      setFormState((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          [field]: value,
        };
      });
    },
    [],
  );

  type PointsField = 'theoryPoints' | 'practicePoints';

  const handlePointChange = useCallback((field: PointsField, index: number, value: string) => {
    setFormState((current) => {
      if (!current) {
        return current;
      }
      const nextPoints = [...current[field]];
      nextPoints[index] = value;
      return {
        ...current,
        [field]: nextPoints,
      };
    });
  }, []);

  const handleAddPoint = useCallback((field: PointsField) => {
    setFormState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        [field]: [...current[field], ''],
      };
    });
  }, []);

  const handleRemovePoint = useCallback((field: PointsField, index: number) => {
    setFormState((current) => {
      if (!current) {
        return current;
      }
      const nextPoints = current[field].filter((_, position) => position !== index);
      return {
        ...current,
        [field]: nextPoints,
      };
    });
  }, []);

  const updateTemplateInState = useCallback((updatedTemplate: TrainingTemplate) => {
    setTemplates((current) => {
      const index = current.findIndex((entry) => entry.id === updatedTemplate.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = updatedTemplate;
        return next;
      }
      return [...current, updatedTemplate];
    });
  }, []);

  const normaliseTemplateName = useCallback(
    (value: string) => {
      const trimmed = value?.trim?.() ?? '';
      if (!trimmed) {
        return '';
      }
      const normaliser = api?.normaliseName;
      return typeof normaliser === 'function' ? normaliser(trimmed) : trimmed.toLowerCase();
    },
    [api]
  );

  const hasTemplateWithName = useCallback(
    (name: string, ignoreId?: string) => {
      const normalised = normaliseTemplateName(name);
      if (!normalised) {
        return false;
      }
      return templates.some((template) => {
        if (ignoreId && template.id === ignoreId) {
          return false;
        }
        return normaliseTemplateName(template.name) === normalised;
      });
    },
    [normaliseTemplateName, templates]
  );

  const handlePersistTemplate = useCallback(
    async (payload: TrainingTemplateInput, successMessage?: string) => {
      if (!api) {
        return;
      }
      setIsSaving(true);
      try {
        const saved = await api.saveTemplate(payload);
        if (!saved) {
          throw new Error('No se pudo guardar la plantilla.');
        }
        updateTemplateInState(saved);
        setSelectedTemplateId(saved.id);
        setFormState(mapTemplateToFormState(saved, api));
        onNotify({
          variant: 'success',
          message:
            successMessage ??
            `La plantilla "${saved.title || saved.name}" se ha guardado correctamente.`,
        });
      } catch (error) {
        const message = resolveErrorMessage(error);
        onNotify({ variant: 'danger', message });
      } finally {
        setIsSaving(false);
      }
    },
    [api, onNotify, updateTemplateInState]
  );

  const handleFormSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!api || !formState) {
        return;
      }

      const name = formState.name.trim();
      const trimmedId = formState.id?.trim?.() ?? '';
      const isEditingExisting = trimmedId.length > 0 && templates.some((template) => template.id === trimmedId);
      const ignoreId = isEditingExisting ? trimmedId : undefined;
      if (hasTemplateWithName(name, ignoreId)) {
        onNotify({ variant: 'danger', message: 'Ya existe una plantilla con ese nombre.' });
        return;
      }

      const overrides: Partial<TrainingTemplateInput> = {};
      if (isEditingExisting && trimmedId) {
        overrides.id = trimmedId;
        overrides.mode = 'update';
      } else {
        overrides.mode = 'create';
      }

      const payload = buildPayloadFromState(formState, overrides);
      const successMessage = overrides.mode === 'update' ? 'Plantilla actualizada correctamente.' : undefined;
      await handlePersistTemplate(payload, successMessage);
    },
    [api, formState, handlePersistTemplate, hasTemplateWithName, onNotify, templates]
  );

  const handleSaveAsNew = useCallback(async () => {
    if (!api || !formState) {
      return;
    }

    const suggestedName = formState.name ? `${formState.name} (copia)` : '';
    const requestedName = window.prompt('Introduce un nombre para la nueva plantilla:', suggestedName ?? '');
    if (requestedName === null) {
      return;
    }

    const trimmedName = requestedName.trim();
    if (!trimmedName) {
      onNotify({ variant: 'danger', message: 'Debes introducir un nombre para la nueva plantilla.' });
      return;
    }

    if (hasTemplateWithName(trimmedName)) {
      onNotify({ variant: 'danger', message: 'Ya existe una plantilla con ese nombre.' });
      return;
    }

    const payload = buildPayloadFromState(formState, { id: undefined, name: trimmedName, mode: 'create' });
    await handlePersistTemplate(payload, `La plantilla "${trimmedName}" se ha creado correctamente.`);
  }, [api, formState, handlePersistTemplate, hasTemplateWithName, onNotify]);

  const handleDuplicateTemplate = useCallback(async () => {
    if (!api || !formState || !formState.id) {
      return;
    }

    const duplicateName = formState.name ? `${formState.name} (copia)` : 'Nueva plantilla';
    const requestedName = window.prompt('Introduce un nombre para la plantilla duplicada:', duplicateName);
    if (requestedName === null) {
      return;
    }

    const trimmedName = requestedName.trim();
    if (!trimmedName) {
      onNotify({ variant: 'danger', message: 'Debes introducir un nombre para la nueva plantilla.' });
      return;
    }

    if (hasTemplateWithName(trimmedName)) {
      onNotify({ variant: 'danger', message: 'Ya existe una plantilla con ese nombre.' });
      return;
    }

    const payload = buildPayloadFromState(formState, { id: undefined, name: trimmedName, mode: 'create' });
    await handlePersistTemplate(payload, `La plantilla "${trimmedName}" se ha duplicado correctamente.`);
  }, [api, formState, handlePersistTemplate, hasTemplateWithName, onNotify]);

  const handleDelete = useCallback(async () => {
    if (!api || !formState || !formState.id || !formState.isCustom) {
      return;
    }

    const confirmation = window.confirm('¿Seguro que quieres eliminar esta plantilla personalizada?');
    if (!confirmation) {
      return;
    }

    try {
      const deleted = await api.deleteTemplate(formState.id);
      if (deleted) {
        onNotify({ variant: 'success', message: 'La plantilla personalizada se ha eliminado correctamente.' });
        const remainingTemplates = await api.listTemplates();
        setTemplates(remainingTemplates);
        if (remainingTemplates.length > 0) {
          const nextTemplate = remainingTemplates[0];
          setSelectedTemplateId(nextTemplate.id);
          setFormState(mapTemplateToFormState(nextTemplate, api));
        } else {
          setSelectedTemplateId('');
          setFormState(buildEmptyFormState(api));
        }
      } else {
        onNotify({ variant: 'danger', message: 'No se ha podido eliminar la plantilla seleccionada.' });
      }
    } catch (error) {
      const message = resolveErrorMessage(error);
      onNotify({ variant: 'danger', message });
    }
  }, [api, formState, onNotify]);

  const isLoading = !api && !initialisationError;
  const selectedTemplate = selectedTemplateId
    ? templates.find((template) => template.id === selectedTemplateId)
    : null;
  const products = productsQuery.data ?? [];
  const associatedTrainingNames = useMemo(() => {
    if (!selectedTemplate) {
      return [] as string[];
    }

    const templateCandidates = [selectedTemplate.id, selectedTemplate.name, selectedTemplate.title]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => value.length > 0);

    if (!templateCandidates.length) {
      return [] as string[];
    }

    const directValues = new Set(templateCandidates);
    const normalisedValues = new Set(
      templateCandidates
        .map((candidate) => normaliseTemplateKey(candidate))
        .filter((candidate): candidate is string => Boolean(candidate)),
    );

    return products
      .filter((product) => {
        const rawTemplate = product.template ?? '';
        const trimmedTemplate = rawTemplate.trim();
        if (!trimmedTemplate) {
          return false;
        }

        const templateValues = extractTemplateTokens(trimmedTemplate);
        const candidates = templateValues.length ? templateValues : [trimmedTemplate];

        return candidates.some((value) => {
          if (directValues.has(value)) {
            return true;
          }
          const normalised = normaliseTemplateKey(value);
          return Boolean(normalised && normalisedValues.has(normalised));
        });
      })
      .map((product) => resolveProductLabel(product))
      .filter((label, index, array) => label.length > 0 && array.indexOf(label) === index)
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  }, [products, selectedTemplate]);
  const isLoadingAssociations = productsQuery.isLoading || productsQuery.isFetching;
  const associationsError = productsQuery.error ? resolveErrorMessage(productsQuery.error) : null;
  const canDuplicate = Boolean(formState?.id);
  const theoryPoints = formState?.theoryPoints ?? [];
  const practicePoints = formState?.practicePoints ?? [];
  return (
    <div className="d-grid gap-4">
      <section className="d-grid gap-3 gap-md-2">
        <div>
          <h1 className="h3 fw-bold mb-0">Templates de Certificados</h1>
        </div>
        <div className="d-flex flex-wrap align-items-center gap-3">
          {(isLoading || isSaving) && <Spinner animation="border" role="status" size="sm" className="me-1" />}
          <Button onClick={handleCreateTemplate} disabled={!api || isSaving}>
            Nueva plantilla personalizada
          </Button>
        </div>
      </section>

      {initialisationError && (
        <Alert variant="danger" className="mb-0">
          {initialisationError}
        </Alert>
      )}

      <Row className="g-4">
        <Col className="d-flex flex-column gap-3">
          <Form.Group controlId="template-selector" className="d-grid gap-2">
            <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2">
              <Form.Label className="mb-0 fw-semibold">Plantilla activa</Form.Label>
              <Badge bg="secondary">{templates.length}</Badge>
            </div>
            <Form.Select
              value={selectedTemplateId}
              onChange={handleTemplateSelectionChange}
              disabled={!templates.length && !formState}
            >
              <option value="">Selecciona una plantilla</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name || template.title || 'Sin nombre'}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <Card className="h-100">
            <Card.Header className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2">
              <span className="fw-semibold">
                {formState?.name ? `Editar plantilla: ${formState.name}` : 'Nueva plantilla personalizada'}
              </span>
              {formState && (
                <Badge bg={formState.isCustom ? 'info' : 'secondary'}>
                  {formState.isCustom ? 'Personalizada' : 'Predeterminada'}
                </Badge>
              )}
            </Card.Header>
            <Card.Body>
              {formState ? (
                <Form onSubmit={handleFormSubmit} className="d-grid gap-4">
                  <div className="d-grid gap-3 gap-md-4">
                    <Row className="g-3">
                      <Col md={6}>
                        <Form.Group controlId="template-name">
                          <Form.Label>Nombre de la plantilla</Form.Label>
                          <Form.Control
                            type="text"
                            value={formState.name}
                            onChange={(event) => handleFormChange('name', event.target.value)}
                            placeholder="Ej. Trabajos en Altura"
                            required
                          />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group controlId="template-title">
                          <Form.Label>Título del certificado</Form.Label>
                          <Form.Control
                            type="text"
                            value={formState.title}
                            onChange={(event) => handleFormChange('title', event.target.value)}
                            placeholder="Texto que aparece como título en el certificado"
                          />
                        </Form.Group>
                      </Col>
                    </Row>
                    <Row className="g-3">
                      <Col md={12}>
                        <div className="d-grid gap-2">
                          <span className="text-muted small text-uppercase fw-semibold">
                            Formaciones asociadas
                          </span>
                          {selectedTemplate && isLoadingAssociations ? (
                            <div className="d-flex align-items-center gap-2 text-muted small">
                              <Spinner animation="border" role="status" size="sm" />
                              <span>Cargando formaciones asociadas…</span>
                            </div>
                          ) : selectedTemplate && associationsError ? (
                            <div className="text-danger small">
                              No se pudieron cargar las formaciones asociadas. {associationsError}
                            </div>
                          ) : associatedTrainingNames.length ? (
                            <div className="d-flex flex-wrap gap-2">
                              {associatedTrainingNames.map((name) => (
                                <Badge key={name} bg="secondary">
                                  {name}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="mb-0 small text-muted">No hay formaciones asociadas.</p>
                          )}
                        </div>
                      </Col>
                    </Row>
                    <Row className="g-4 align-items-stretch">
                      <Col xs={12} lg={6} className="d-flex">
                        <Form.Group controlId="template-theory" className="d-grid gap-3 flex-grow-1">
                          <Form.Label>Contenido teórico</Form.Label>
                          <div className="d-grid gap-3 flex-grow-1">
                            {theoryPoints.length > 0 ? (
                              theoryPoints.map((point, index) => (
                                <div key={`theory-${index}`} className="d-flex flex-column flex-md-row gap-2">
                                  <Form.Control
                                    as="textarea"
                                    rows={2}
                                    value={point}
                                    onChange={(event) =>
                                      handlePointChange('theoryPoints', index, event.target.value)
                                    }
                                    placeholder={`Punto teórico ${index + 1}`}
                                    className="certificate-template-point-input"
                                  />
                                  <Button
                                    variant="outline-danger"
                                    type="button"
                                    onClick={() => handleRemovePoint('theoryPoints', index)}
                                    className="flex-shrink-0"
                                  >
                                    Eliminar
                                  </Button>
                                </div>
                              ))
                            ) : (
                              <p className="text-muted small mb-0">
                                No hay puntos teóricos. Añade un punto para comenzar.
                              </p>
                            )}
                            <div>
                              <Button
                                variant="outline-primary"
                                type="button"
                                onClick={() => handleAddPoint('theoryPoints')}
                                className="w-100 w-md-auto"
                              >
                                Añadir punto teórico
                              </Button>
                            </div>
                          </div>
                        </Form.Group>
                      </Col>
                      <Col xs={12} lg={6} className="d-flex">
                        <Form.Group controlId="template-practice" className="d-grid gap-3 flex-grow-1">
                          <Form.Label>Contenido práctico</Form.Label>
                          <div className="d-grid gap-3 flex-grow-1">
                            {practicePoints.length > 0 ? (
                              practicePoints.map((point, index) => (
                                <div key={`practice-${index}`} className="d-flex flex-column flex-md-row gap-2">
                                  <Form.Control
                                    as="textarea"
                                    rows={2}
                                    value={point}
                                    onChange={(event) =>
                                      handlePointChange('practicePoints', index, event.target.value)
                                    }
                                    placeholder={`Punto práctico ${index + 1}`}
                                    className="certificate-template-point-input"
                                  />
                                  <Button
                                    variant="outline-danger"
                                    type="button"
                                    onClick={() => handleRemovePoint('practicePoints', index)}
                                    className="flex-shrink-0"
                                  >
                                    Eliminar
                                  </Button>
                                </div>
                              ))
                            ) : (
                              <p className="text-muted small mb-0">
                                No hay puntos prácticos. Añade un punto para comenzar.
                              </p>
                            )}
                            <div>
                              <Button
                                variant="outline-primary"
                                type="button"
                                onClick={() => handleAddPoint('practicePoints')}
                                className="w-100 w-md-auto"
                              >
                                Añadir punto práctico
                              </Button>
                            </div>
                          </div>
                        </Form.Group>
                      </Col>
                    </Row>
                  </div>

                  <div className="d-flex flex-column flex-lg-row gap-3 align-items-stretch">
                    <div className="d-flex flex-column flex-lg-row gap-2 w-100 justify-content-lg-end">
                      <Button
                        variant="outline-secondary"
                        onClick={handleDuplicateTemplate}
                        disabled={!canDuplicate || isSaving}
                        className="w-100 w-lg-auto px-4"
                      >
                        Duplicar plantilla
                      </Button>
                      <Button
                        variant="outline-danger"
                        onClick={handleDelete}
                        disabled={!formState.isCustom || !formState.id || isSaving}
                        className="w-100 w-lg-auto px-4"
                      >
                        Eliminar plantilla
                      </Button>
                      <Button
                        variant="outline-primary"
                        onClick={handleSaveAsNew}
                        disabled={!formState || isSaving}
                        className="w-100 w-lg-auto px-4"
                      >
                        ¿Añadir como plantilla nueva?
                      </Button>
                      <Button type="submit" disabled={isSaving} className="w-100 w-lg-auto px-4">
                        {isSaving ? 'Guardando…' : 'Guardar cambios'}
                      </Button>
                    </div>
                  </div>
                </Form>
              ) : (
                <div className="text-center text-muted py-5">
                  Selecciona una plantilla de la lista o crea una nueva para comenzar.
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

