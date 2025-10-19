import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  Row,
  Spinner,
  Table,
} from 'react-bootstrap';

import {
  getTrainingTemplatesManager,
  type TrainingTemplate,
  type TrainingTemplateInput,
  type TrainingTemplatesManager,
} from '../certificados/lib/templates/training-templates';

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
  theoryText: string;
  practiceText: string;
  persistId: boolean;
  isCustom: boolean;
};

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error.trim();
  }
  return 'Se ha producido un error inesperado.';
}

function normaliseListInput(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
  return {
    id: template.id ?? '',
    name: template.name ?? '',
    title: template.title ?? '',
    duration: template.duration ?? '',
    theoryText: Array.isArray(template.theory) ? template.theory.join('\n') : '',
    practiceText: Array.isArray(template.practice) ? template.practice.join('\n') : '',
    persistId: isCustom,
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
    theoryText: '',
    practiceText: '',
    persistId: false,
    isCustom: true,
  };
}

export function CertificateTemplatesView({ onNotify }: CertificateTemplatesViewProps) {
  const [templates, setTemplates] = useState<TrainingTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [formState, setFormState] = useState<TemplateFormState | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [initialisationError, setInitialisationError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    try {
      const api = getTrainingTemplatesApi();
      const list = api.listTemplates();
      setTemplates(list);
      if (list.length > 0) {
        const initial = list[0];
        setSelectedTemplateId(initial.id);
        setFormState(mapTemplateToFormState(initial, api));
      }

      if (typeof api.subscribe === 'function') {
        unsubscribe = api.subscribe(() => {
          const updatedTemplates = api.listTemplates();
          setTemplates(updatedTemplates);
        });
      }
    } catch (error) {
      setInitialisationError(resolveErrorMessage(error));
    }

    return () => {
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

  const handleSelectTemplate = useCallback(
    (template: TrainingTemplate) => {
      if (!api) {
        return;
      }
      setSelectedTemplateId(template.id);
      setFormState(mapTemplateToFormState(template, api));
    },
    [api]
  );

  const handleFormChange = useCallback((field: keyof TemplateFormState, value: string | boolean) => {
    setFormState((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        [field]: value,
      };
    });
  }, []);

  const handleSave = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!api || !formState) {
        return;
      }

      setIsSaving(true);
      try {
        const payload: TrainingTemplateInput = {
          id: formState.persistId ? formState.id : undefined,
          name: formState.name.trim(),
          title: formState.title.trim(),
          duration: formState.duration.trim(),
          theory: normaliseListInput(formState.theoryText),
          practice: normaliseListInput(formState.practiceText),
        };

        const saved = api.saveTemplate(payload);
        if (!saved) {
          throw new Error('No se pudo guardar la plantilla.');
        }
        setSelectedTemplateId(saved.id);
        setFormState(mapTemplateToFormState(saved, api));
        onNotify({
          variant: 'success',
          message: `La plantilla "${saved.title || saved.name}" se ha guardado correctamente.`,
        });
      } catch (error) {
        const message = resolveErrorMessage(error);
        onNotify({ variant: 'danger', message });
      } finally {
        setIsSaving(false);
      }
    },
    [api, formState, onNotify]
  );

  const handleDelete = useCallback(() => {
    if (!api || !formState || !formState.id || !formState.isCustom) {
      return;
    }

    const confirmation = window.confirm('¿Seguro que quieres eliminar esta plantilla personalizada?');
    if (!confirmation) {
      return;
    }

    const deleted = api.deleteTemplate(formState.id);
    if (deleted) {
      onNotify({ variant: 'success', message: 'La plantilla personalizada se ha eliminado correctamente.' });
      const remainingTemplates = api.listTemplates();
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
  }, [api, formState, onNotify]);

  const isLoading = !api && !initialisationError;
  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Templates de Certificados</h1>
          <p className="text-muted mb-0">
            Gestiona la información que aparece en la generación automática de los certificados.
          </p>
        </div>
        <div className="d-flex align-items-center gap-3">
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
        <Col lg={5} className="d-flex flex-column gap-4">
          <Card className="h-100">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <span className="fw-semibold">Plantillas disponibles</span>
              <Badge bg="secondary">{templates.length}</Badge>
            </Card.Header>
            <Card.Body className="p-0">
              <div className="table-responsive">
                <Table hover className="mb-0 align-middle">
                  <thead>
                    <tr>
                      <th style={{ minWidth: 180 }}>Nombre</th>
                      <th style={{ minWidth: 180 }}>Título</th>
                      <th style={{ minWidth: 80 }}>Duración</th>
                      <th style={{ minWidth: 140 }}>Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {templates.map((template) => {
                      const isActive = template.id === selectedTemplateId;
                      const isCustom = Boolean(api?.isCustomTemplateId?.(template.id));
                      return (
                        <tr
                          key={template.id}
                          className={isActive ? 'table-active' : undefined}
                          role="button"
                          onClick={() => handleSelectTemplate(template)}
                        >
                          <td>{template.name || 'Sin nombre'}</td>
                          <td>{template.title || '—'}</td>
                          <td>{template.duration || '—'}</td>
                          <td>
                            <Badge bg={isCustom ? 'info' : 'secondary'}>
                              {isCustom ? 'Personalizada' : 'Predeterminada'}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                    {!templates.length && (
                      <tr>
                        <td colSpan={4} className="text-center text-muted py-4">
                          No hay plantillas disponibles.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </Table>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={7} className="d-flex flex-column gap-4">
          <Card className="h-100">
            <Card.Header>
              <span className="fw-semibold">
                {formState?.name ? `Editar plantilla: ${formState.name}` : 'Nueva plantilla personalizada'}
              </span>
            </Card.Header>
            <Card.Body>
              {formState ? (
                <Form onSubmit={handleSave} className="d-grid gap-4">
                  <div className="d-grid gap-3 gap-md-4">
                    <Row className="g-3">
                      <Col md={6}>
                        <Form.Group controlId="template-name">
                          <Form.Label>Nombre de la formación</Form.Label>
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
                      <Col md={6}>
                        <Form.Group controlId="template-duration">
                          <Form.Label>Duración</Form.Label>
                          <Form.Control
                            type="text"
                            value={formState.duration}
                            onChange={(event) => handleFormChange('duration', event.target.value)}
                            placeholder="Ej. 8h"
                          />
                          <Form.Text className="text-muted">
                            Se mostrará junto a los datos de la formación en el certificado.
                          </Form.Text>
                        </Form.Group>
                      </Col>
                      <Col md={6} className="d-flex align-items-center">
                        <div>
                          <p className="mb-1 small text-muted">
                            {formState.isCustom
                              ? 'Esta plantilla es personalizada y se puede eliminar.'
                              : 'Las plantillas predeterminadas se pueden editar para crear una versión personalizada.'}
                          </p>
                          {!formState.isCustom && (
                            <Badge bg="secondary">Se creará una copia personalizada al guardar</Badge>
                          )}
                        </div>
                      </Col>
                    </Row>
                    <Form.Group controlId="template-theory">
                      <Form.Label>Contenido teórico</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={6}
                        value={formState.theoryText}
                        onChange={(event) => handleFormChange('theoryText', event.target.value)}
                        placeholder="Introduce cada punto en una línea diferente"
                      />
                    </Form.Group>
                    <Form.Group controlId="template-practice">
                      <Form.Label>Contenido práctico</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={6}
                        value={formState.practiceText}
                        onChange={(event) => handleFormChange('practiceText', event.target.value)}
                        placeholder="Introduce cada punto en una línea diferente"
                      />
                    </Form.Group>
                  </div>

                  <div className="d-flex flex-column flex-md-row gap-3 justify-content-between align-items-md-center">
                    <div className="text-muted small">
                      Los cambios se guardan localmente en el navegador para su uso en la generación de certificados.
                    </div>
                    <div className="d-flex flex-column flex-md-row gap-2">
                      <Button
                        variant="outline-danger"
                        onClick={handleDelete}
                        disabled={!formState.isCustom || !formState.id || isSaving}
                      >
                        Eliminar plantilla
                      </Button>
                      <Button type="submit" disabled={isSaving}>
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

