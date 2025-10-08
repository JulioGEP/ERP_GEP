// frontend/src/features/recursos/TrainerModal.tsx
import { useEffect, useMemo, useState } from "react";
import { Button, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import type { Trainer } from "../../types/trainer";

export type TrainerFormValues = {
  trainer_id: string;
  name: string;
  apellido: string;
  email: string;
  phone: string;
  dni: string;
  direccion: string;
  especialidad: string;
  titulacion: string;
  activo: boolean;
};

type TrainerModalProps = {
  show: boolean;
  mode: "create" | "edit";
  initialData?: Trainer | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: TrainerFormValues) => void;
};

const EMPTY_FORM: TrainerFormValues = {
  trainer_id: "",
  name: "",
  apellido: "",
  email: "",
  phone: "",
  dni: "",
  direccion: "",
  especialidad: "",
  titulacion: "",
  activo: true,
};

function trainerToFormValues(trainer?: Trainer | null): TrainerFormValues {
  if (!trainer) return { ...EMPTY_FORM };

  return {
    trainer_id: trainer.trainer_id ?? "",
    name: trainer.name ?? "",
    apellido: trainer.apellido ?? "",
    email: trainer.email ?? "",
    phone: trainer.phone ?? "",
    dni: trainer.dni ?? "",
    direccion: trainer.direccion ?? "",
    especialidad: trainer.especialidad ?? "",
    titulacion: trainer.titulacion ?? "",
    activo: trainer.activo ?? false,
  };
}

export function TrainerModal({
  show,
  mode,
  initialData,
  isSaving,
  onClose,
  onSubmit,
}: TrainerModalProps) {
  const [formValues, setFormValues] = useState<TrainerFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (show) {
      setFormValues(trainerToFormValues(initialData));
      setError(null);
    }
  }, [show, initialData]);

  const modalTitle = useMemo(
    () => (mode === "create" ? "Añadir Formador/Bombero" : "Editar Formador/Bombero"),
    [mode]
  );

  const handleChange = (field: keyof TrainerFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = field === "activo" ? (event.target as HTMLInputElement).checked : event.target.value;
      setFormValues((prev) => ({ ...prev, [field]: value }));
    };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = formValues.name.trim();
    if (!trimmedName.length) {
      setError("El nombre es obligatorio");
      return;
    }

    setError(null);

    const payload: TrainerFormValues = {
      ...formValues,
      trainer_id: formValues.trainer_id.trim(),
      name: trimmedName,
      apellido: formValues.apellido.trim(),
      email: formValues.email.trim(),
      phone: formValues.phone.trim(),
      dni: formValues.dni.trim(),
      direccion: formValues.direccion.trim(),
      especialidad: formValues.especialidad.trim(),
      titulacion: formValues.titulacion.trim(),
    };

    onSubmit(payload);
  };

  return (
    <Modal show={show} onHide={isSaving ? undefined : onClose} size="lg" centered backdrop="static">
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
          <Row className="g-3">
            <Col md={6}>
              <Form.Group controlId="trainerId">
                <Form.Label>ID Formador</Form.Label>
                <Form.Control
                  type="text"
                  placeholder="Generado automáticamente si se deja en blanco"
                  value={formValues.trainer_id}
                  onChange={handleChange("trainer_id")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="trainerName">
                <Form.Label>Nombre *</Form.Label>
                <Form.Control
                  type="text"
                  required
                  value={formValues.name}
                  onChange={handleChange("name")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="trainerApellido">
                <Form.Label>Apellido</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.apellido}
                  onChange={handleChange("apellido")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="trainerEspecialidad">
                <Form.Label>Especialidad</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.especialidad}
                  onChange={handleChange("especialidad")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="trainerEmail">
                <Form.Label>Email</Form.Label>
                <Form.Control
                  type="email"
                  value={formValues.email}
                  onChange={handleChange("email")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="trainerPhone">
                <Form.Label>Teléfono</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.phone}
                  onChange={handleChange("phone")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="trainerDni">
                <Form.Label>DNI</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.dni}
                  onChange={handleChange("dni")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="trainerTitulacion">
                <Form.Label>Titulación</Form.Label>
                <Form.Control
                  type="text"
                  value={formValues.titulacion}
                  onChange={handleChange("titulacion")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
            <Col md={12}>
              <Form.Group controlId="trainerDireccion">
                <Form.Label>Dirección</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={2}
                  value={formValues.direccion}
                  onChange={handleChange("direccion")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
            <Col xs={12}>
              <Form.Group controlId="trainerActivo">
                <Form.Check
                  type="switch"
                  label="Activo"
                  checked={formValues.activo}
                  onChange={handleChange("activo")}
                  disabled={isSaving}
                />
              </Form.Group>
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <>
                <Spinner as="span" size="sm" animation="border" role="status" className="me-2" />
                Guardando...
              </>
            ) : (
              "Guardar cambios"
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
