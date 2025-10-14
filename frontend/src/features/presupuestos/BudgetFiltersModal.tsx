import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { Button, Col, Form, Modal, Row, Stack } from 'react-bootstrap';
import type { BudgetFilters } from './budgetFilters';
import { SEDE_OPTIONS, YES_NO_CHOICES, cleanBudgetFilters } from './budgetFilters';

interface BudgetFiltersModalProps {
  show: boolean;
  filters: BudgetFilters;
  titleOptions: string[];
  trainingAddressOptions: string[];
  onApply: (filters: BudgetFilters) => void;
  onClearAll: () => void;
  onClose: () => void;
}

type FormState = {
  title: string;
  training_address: string;
  org_id: string;
  pipeline_id: string;
  sede_label: string;
  caes_label: string;
  fundae_label: string;
  hotel_label: string;
  transporte: string;
  person_id: string;
  po: string;
};

const EMPTY_STATE: FormState = {
  title: '',
  training_address: '',
  org_id: '',
  pipeline_id: '',
  sede_label: '',
  caes_label: '',
  fundae_label: '',
  hotel_label: '',
  transporte: '',
  person_id: '',
  po: '',
};

function filtersToFormState(filters: BudgetFilters): FormState {
  return {
    title: filters.title ?? '',
    training_address: filters.training_address ?? '',
    org_id: filters.org_id ?? '',
    pipeline_id: filters.pipeline_id ?? '',
    sede_label: filters.sede_label ?? '',
    caes_label: filters.caes_label ?? '',
    fundae_label: filters.fundae_label ?? '',
    hotel_label: filters.hotel_label ?? '',
    transporte: filters.transporte ?? '',
    person_id: filters.person_id ?? '',
    po: filters.po ?? '',
  };
}

function parseFormState(state: FormState): BudgetFilters {
  const parsed: BudgetFilters = {};

  if (state.title.trim().length) parsed.title = state.title;
  if (state.training_address.trim().length) parsed.training_address = state.training_address;
  if (state.org_id.trim().length) parsed.org_id = state.org_id;
  if (state.pipeline_id.trim().length) parsed.pipeline_id = state.pipeline_id;
  if (state.sede_label.trim().length) parsed.sede_label = state.sede_label as BudgetFilters['sede_label'];
  if (state.caes_label.trim().length) parsed.caes_label = state.caes_label as BudgetFilters['caes_label'];
  if (state.fundae_label.trim().length) parsed.fundae_label = state.fundae_label as BudgetFilters['fundae_label'];
  if (state.hotel_label.trim().length) parsed.hotel_label = state.hotel_label as BudgetFilters['hotel_label'];
  if (state.transporte.trim().length) parsed.transporte = state.transporte as BudgetFilters['transporte'];
  if (state.person_id.trim().length) parsed.person_id = state.person_id;
  if (state.po.trim().length) parsed.po = state.po;

  return cleanBudgetFilters(parsed);
}

export function BudgetFiltersModal({
  show,
  filters,
  titleOptions,
  trainingAddressOptions,
  onApply,
  onClearAll,
  onClose,
}: BudgetFiltersModalProps) {
  const [formState, setFormState] = useState<FormState>({ ...EMPTY_STATE });
  const titleDatalistId = useId();
  const addressDatalistId = useId();
  type FormFieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

  useEffect(() => {
    if (show) {
      setFormState(filtersToFormState(filters));
    }
  }, [filters, show]);

  const filteredTitleOptions = useMemo(() => {
    const query = formState.title.trim().toLowerCase();
    if (query.length < 2) return [];
    return titleOptions
      .filter((option) => option.toLowerCase().includes(query))
      .slice(0, 10);
  }, [formState.title, titleOptions]);

  const filteredAddressOptions = useMemo(() => {
    const query = formState.training_address.trim().toLowerCase();
    if (query.length < 2) return [];
    return trainingAddressOptions
      .filter((option) => option.toLowerCase().includes(query))
      .slice(0, 10);
  }, [formState.training_address, trainingAddressOptions]);

  const handleChange = (field: keyof FormState) => (event: ChangeEvent<FormFieldElement>) => {
    const { value } = event.target;
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply(parseFormState(formState));
  };

  const handleClear = () => {
    setFormState({ ...EMPTY_STATE });
    onClearAll();
  };

  return (
    <Modal show={show} onHide={onClose} size="lg" centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>Filtros de presupuestos</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Stack gap={4}>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="filter-title">
                  <Form.Label>Título</Form.Label>
                  <Form.Control
                    type="text"
                    value={formState.title}
                    onChange={handleChange('title')}
                    placeholder="Buscar por título"
                    list={titleDatalistId}
                  />
                  <Form.Text className="text-muted">Sugerencias disponibles a partir de 2 letras.</Form.Text>
                  <datalist id={titleDatalistId}>
                    {filteredTitleOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="filter-training-address">
                  <Form.Label>Dirección de formación</Form.Label>
                  <Form.Control
                    type="text"
                    value={formState.training_address}
                    onChange={handleChange('training_address')}
                    placeholder="Buscar por dirección"
                    list={addressDatalistId}
                  />
                  <Form.Text className="text-muted">Sugerencias disponibles a partir de 2 letras.</Form.Text>
                  <datalist id={addressDatalistId}>
                    {filteredAddressOptions.map((option) => (
                      <option key={option} value={option} />
                    ))}
                  </datalist>
                </Form.Group>
              </Col>
            </Row>

            <Row className="g-3">
              <Col md={6}>
                <Form.Group controlId="filter-org">
                  <Form.Label>Organización (ID)</Form.Label>
                  <Form.Control
                    type="text"
                    value={formState.org_id}
                    onChange={handleChange('org_id')}
                    placeholder="ID de la organización"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group controlId="filter-pipeline">
                  <Form.Label>Pipeline (ID)</Form.Label>
                  <Form.Control
                    type="text"
                    value={formState.pipeline_id}
                    onChange={handleChange('pipeline_id')}
                    placeholder="ID del pipeline"
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row className="g-3">
              <Col md={4}>
                <Form.Group controlId="filter-sede">
                  <Form.Label>Sede</Form.Label>
                  <Form.Select value={formState.sede_label} onChange={handleChange('sede_label')}>
                    <option value="">Cualquiera</option>
                    {SEDE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="filter-caes">
                  <Form.Label>CAES</Form.Label>
                  <Form.Select value={formState.caes_label} onChange={handleChange('caes_label')}>
                    <option value="">Cualquiera</option>
                    {YES_NO_CHOICES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="filter-fundae">
                  <Form.Label>FUNDAE</Form.Label>
                  <Form.Select value={formState.fundae_label} onChange={handleChange('fundae_label')}>
                    <option value="">Cualquiera</option>
                    {YES_NO_CHOICES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <Row className="g-3">
              <Col md={4}>
                <Form.Group controlId="filter-hotel">
                  <Form.Label>Hotel</Form.Label>
                  <Form.Select value={formState.hotel_label} onChange={handleChange('hotel_label')}>
                    <option value="">Cualquiera</option>
                    {YES_NO_CHOICES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="filter-transporte">
                  <Form.Label>Transporte</Form.Label>
                  <Form.Select value={formState.transporte} onChange={handleChange('transporte')}>
                    <option value="">Cualquiera</option>
                    {YES_NO_CHOICES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group controlId="filter-person">
                  <Form.Label>Contacto (ID)</Form.Label>
                  <Form.Control
                    type="text"
                    value={formState.person_id}
                    onChange={handleChange('person_id')}
                    placeholder="ID de la persona"
                  />
                </Form.Group>
              </Col>
            </Row>

            <Form.Group controlId="filter-po">
              <Form.Label>PO</Form.Label>
              <Form.Control
                type="text"
                value={formState.po}
                onChange={handleChange('po')}
                placeholder="Número de PO"
              />
            </Form.Group>
          </Stack>
        </Modal.Body>
        <Modal.Footer className="justify-content-between">
          <Button variant="link" className="text-decoration-none" onClick={handleClear}>
            Limpiar filtros
          </Button>
          <div className="d-flex gap-2">
            <Button variant="outline-secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary">
              Filtrar
            </Button>
          </div>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
