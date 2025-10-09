// frontend/src/features/recursos/MobileUnitModal.tsx
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import type { MobileUnit } from "../../types/mobile-unit";

export type MobileUnitFormValues = {
  name: string;
  matricula: string;
  tipo: string;
  sede: string;
};

type MobileUnitModalProps = {
  show: boolean;
  mode: "create" | "edit";
  initialData?: MobileUnit | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: MobileUnitFormValues) => void;
};

const EMPTY_FORM: MobileUnitFormValues = {
  name: "",
  matricula: "",
  tipo: "",
  sede: "",
};

function unitToFormValues(unit?: MobileUnit | null): MobileUnitFormValues {
  if (!unit) return { ...EMPTY_FORM };

  return {
    name: unit.name ?? "",
    matricula: unit.matricula ?? "",
    tipo: unit.tipo ?? "",
    sede: unit.sede ?? "",
  };
}

export function MobileUnitModal({
  show,
  mode,
  initialData,
  isSaving,
  onClose,
  onSubmit,
}: MobileUnitModalProps) {
  const [formValues, setFormValues] = useState<MobileUnitFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (show) {
      setFormValues(unitToFormValues(initialData));
      setError(null);
    }
  }, [show, initialData]);

  const modalTitle = useMemo(
    () => (mode === "create" ? "Añadir Unidad Móvil" : "Editar Unidad Móvil"),
    [mode]
  );

  const handleChange = (field: keyof MobileUnitFormValues) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setFormValues((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedValues: MobileUnitFormValues = {
      name: formValues.name.trim(),
      matricula: formValues.matricula.trim(),
      tipo: formValues.tipo.trim(),
      sede: formValues.sede.trim(),
    };

    if (!trimmedValues.name || !trimmedValues.matricula || !trimmedValues.tipo || !trimmedValues.sede) {
      setError("Todos los campos son obligatorios");
      return;
    }

    setError(null);
    onSubmit(trimmedValues);
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
          <div className="d-grid gap-3">
            <Form.Group controlId="mobileUnitName">
              <Form.Label>Nombre *</Form.Label>
              <Form.Control
                type="text"
                required
                value={formValues.name}
                onChange={handleChange("name")}
                disabled={isSaving}
              />
            </Form.Group>
            <Form.Group controlId="mobileUnitMatricula">
              <Form.Label>Matrícula *</Form.Label>
              <Form.Control
                type="text"
                required
                value={formValues.matricula}
                onChange={handleChange("matricula")}
                disabled={isSaving}
              />
            </Form.Group>
            <Form.Group controlId="mobileUnitTipo">
              <Form.Label>Tipo *</Form.Label>
              <Form.Control
                type="text"
                required
                value={formValues.tipo}
                onChange={handleChange("tipo")}
                disabled={isSaving}
              />
            </Form.Group>
            <Form.Group controlId="mobileUnitSede">
              <Form.Label>Sede *</Form.Label>
              <Form.Control
                type="text"
                required
                value={formValues.sede}
                onChange={handleChange("sede")}
                disabled={isSaving}
              />
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={onClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <>
                <Spinner animation="border" role="status" size="sm" className="me-2" />
                Guardando...
              </>
            ) : (
              "Guardar"
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
