// frontend/src/features/recursos/RoomModal.tsx
import { useEffect, useMemo, useState } from 'react';
import { Button, Form, Modal, Spinner } from 'react-bootstrap';
import type { Room } from '../../types/room';
import { SEDE_OPTIONS } from './trainers.constants';

export type RoomFormValues = {
  name: string;
  sede: string;
};

type RoomModalProps = {
  show: boolean;
  mode: 'create' | 'edit';
  initialData?: Room | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: RoomFormValues) => void;
};

const EMPTY_FORM: RoomFormValues = {
  name: '',
  sede: '',
};

function roomToFormValues(room?: Room | null): RoomFormValues {
  if (!room) return { ...EMPTY_FORM };
  return {
    name: room.name ?? '',
    sede: room.sede ?? '',
  };
}

export function RoomModal({
  show,
  mode,
  initialData,
  isSaving,
  onClose,
  onSubmit,
}: RoomModalProps) {
  const [formValues, setFormValues] = useState<RoomFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (show) {
      setFormValues(roomToFormValues(initialData));
      setError(null);
    }
  }, [show, initialData]);

  const modalTitle = useMemo(
    () => (mode === 'create' ? 'Añadir Sala' : 'Editar Sala'),
    [mode]
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = formValues.name.trim();
    const trimmedSede = formValues.sede.trim();

    if (!trimmedName.length) {
      setError('El nombre es obligatorio');
      return;
    }

    if (!trimmedSede.length) {
      setError('La sede es obligatoria');
      return;
    }

    if (!SEDE_OPTIONS.includes(trimmedSede as (typeof SEDE_OPTIONS)[number])) {
      setError('Selecciona una sede válida');
      return;
    }

    setError(null);
    onSubmit({ name: trimmedName, sede: trimmedSede });
  };

  return (
    <Modal show={show} onHide={isSaving ? undefined : onClose} centered backdrop="static">
      <Form onSubmit={handleSubmit} noValidate>
        <Modal.Header closeButton={!isSaving}>
          <Modal.Title>{modalTitle}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-3">
          {error && (
            <div className="alert alert-danger" role="alert">
              {error}
            </div>
          )}
          <Form.Group controlId="roomName" className="mb-3">
            <Form.Label>Nombre *</Form.Label>
            <Form.Control
              type="text"
              required
              value={formValues.name}
              onChange={(event) =>
                setFormValues((prev) => ({ ...prev, name: event.target.value }))
              }
              disabled={isSaving}
            />
          </Form.Group>
          <Form.Group controlId="roomSede">
            <Form.Label>Sede *</Form.Label>
            <Form.Select
              value={formValues.sede}
              onChange={(event) =>
                setFormValues((prev) => ({ ...prev, sede: event.target.value }))
              }
              disabled={isSaving}
            >
              <option value="">Selecciona una sede</option>
              {SEDE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Form.Select>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <>
                <Spinner as="span" animation="border" size="sm" role="status" className="me-2" />
                Guardando...
              </>
            ) : (
              'Guardar'
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
