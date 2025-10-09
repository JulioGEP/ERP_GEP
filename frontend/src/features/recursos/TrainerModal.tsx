// frontend/src/features/recursos/TrainerModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import type { Trainer } from "../../types/trainer";
import { SEDE_OPTIONS, type SedeOption } from "./trainers.constants";

export type TrainerFormValues = {
  name: string;
  apellido: string;
  email: string;
  phone: string;
  dni: string;
  direccion: string;
  especialidad: string;
  titulacion: string;
  activo: boolean;
  sede: string[];
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
  name: "",
  apellido: "",
  email: "",
  phone: "",
  dni: "",
  direccion: "",
  especialidad: "",
  titulacion: "",
  activo: true,
  sede: [],
};

function trainerToFormValues(trainer?: Trainer | null): TrainerFormValues {
  if (!trainer) return { ...EMPTY_FORM };

  return {
    name: trainer.name ?? "",
    apellido: trainer.apellido ?? "",
    email: trainer.email ?? "",
    phone: trainer.phone ?? "",
    dni: trainer.dni ?? "",
    direccion: trainer.direccion ?? "",
    especialidad: trainer.especialidad ?? "",
    titulacion: trainer.titulacion ?? "",
    activo: trainer.activo ?? false,
    sede: Array.isArray(trainer.sede) ? trainer.sede : [],
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
  const [isSedeMenuOpen, setIsSedeMenuOpen] = useState(false);
  const sedeContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (show) {
      setFormValues(trainerToFormValues(initialData));
      setError(null);
    }
    if (!show) {
      setIsSedeMenuOpen(false);
    }
  }, [show, initialData]);

  useEffect(() => {
    if (!isSedeMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!sedeContainerRef.current) return;
      if (!sedeContainerRef.current.contains(event.target as Node)) {
        setIsSedeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isSedeMenuOpen]);

  useEffect(() => {
    if (isSaving) {
      setIsSedeMenuOpen(false);
    }
  }, [isSaving]);

  const modalTitle = useMemo(
    () => (mode === "create" ? "Añadir Formador/Bombero" : "Editar Formador/Bombero"),
    [mode]
  );

  const handleChange = (field: keyof TrainerFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = field === "activo" ? (event.target as HTMLInputElement).checked : event.target.value;
      setFormValues((prev) => ({ ...prev, [field]: value }));
    };

  const handleSedeToggle = (option: SedeOption) => {
    setFormValues((prev) => {
      const alreadySelected = prev.sede.includes(option);
      const updatedSede = alreadySelected
        ? prev.sede.filter((value) => value !== option)
        : [...prev.sede, option];
      return { ...prev, sede: updatedSede };
    });
  };

  const openSedeMenu = () => {
    if (!isSaving) {
      setIsSedeMenuOpen(true);
    }
  };

  const handleSedeFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === " " || event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      openSedeMenu();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setIsSedeMenuOpen(false);
    }
  };

  const sedeDisplayValue = formValues.sede.join(", ");

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
      name: trimmedName,
      apellido: formValues.apellido.trim(),
      email: formValues.email.trim(),
      phone: formValues.phone.trim(),
      dni: formValues.dni.trim(),
      direccion: formValues.direccion.trim(),
      especialidad: formValues.especialidad.trim(),
      titulacion: formValues.titulacion.trim(),
      sede: formValues.sede.filter((value) => SEDE_OPTIONS.includes(value as (typeof SEDE_OPTIONS)[number])),
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
              <Form.Group controlId="trainerSede">
                <Form.Label>Sede</Form.Label>
                <div ref={sedeContainerRef} className="position-relative">
                  <Form.Control
                    type="text"
                    value={sedeDisplayValue}
                    placeholder="Selecciona una o varias sedes"
                    readOnly
                    onClick={openSedeMenu}
                    onFocus={openSedeMenu}
                    onKeyDown={handleSedeFieldKeyDown}
                    disabled={isSaving}
                    aria-haspopup="listbox"
                    aria-expanded={isSedeMenuOpen}
                    role="combobox"
                  />
                  {isSedeMenuOpen && (
                    <div
                      className="dropdown-menu show w-100 p-3 shadow"
                      role="listbox"
                      aria-multiselectable="true"
                    >
                      {SEDE_OPTIONS.map((option, index) => {
                        const optionId = `trainer-sede-${option.replace(/\s+/g, "-").toLowerCase()}`;
                        return (
                          <Form.Check
                            key={option}
                            id={optionId}
                            type="checkbox"
                            label={option}
                            checked={formValues.sede.includes(option)}
                            onChange={() => handleSedeToggle(option)}
                            className={index !== SEDE_OPTIONS.length - 1 ? "mb-2" : undefined}
                            disabled={isSaving}
                            role="option"
                            aria-selected={formValues.sede.includes(option)}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
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
