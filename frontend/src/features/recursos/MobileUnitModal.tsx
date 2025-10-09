// frontend/src/features/recursos/MobileUnitModal.tsx
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import type { MobileUnit } from "../../types/mobile-unit";
import {
  MOBILE_UNIT_SEDE_OPTIONS,
  MOBILE_UNIT_TIPO_OPTIONS,
} from "./mobileUnits.constants";

export type MobileUnitFormValues = {
  name: string;
  matricula: string;
  tipo: string[];
  sede: string[];
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
  tipo: [],
  sede: [],
};

function sanitizeSelection(values: string[], allowedValues: readonly string[]) {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length);

  const mapped: string[] = [];

  for (const value of normalized) {
    const match = allowedValues.find((allowed) => allowed.toLowerCase() === value.toLowerCase());
    if (match && !mapped.includes(match)) {
      mapped.push(match);
    }
  }

  return mapped;
}

function unitToFormValues(unit?: MobileUnit | null): MobileUnitFormValues {
  if (!unit) return { ...EMPTY_FORM };

  return {
    name: unit.name ?? "",
    matricula: unit.matricula ?? "",
    tipo: Array.isArray(unit.tipo) ? sanitizeSelection(unit.tipo, MOBILE_UNIT_TIPO_OPTIONS) : [],
    sede: Array.isArray(unit.sede) ? sanitizeSelection(unit.sede, MOBILE_UNIT_SEDE_OPTIONS) : [],
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
  const [isTipoMenuOpen, setIsTipoMenuOpen] = useState(false);
  const [isSedeMenuOpen, setIsSedeMenuOpen] = useState(false);
  const tipoContainerRef = useRef<HTMLDivElement | null>(null);
  const sedeContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (show) {
      setFormValues(unitToFormValues(initialData));
      setError(null);
    }
    if (!show) {
      setIsTipoMenuOpen(false);
      setIsSedeMenuOpen(false);
    }
  }, [show, initialData]);

  useEffect(() => {
    if (!isTipoMenuOpen && !isSedeMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (isTipoMenuOpen && tipoContainerRef.current && !tipoContainerRef.current.contains(event.target as Node)) {
        setIsTipoMenuOpen(false);
      }
      if (isSedeMenuOpen && sedeContainerRef.current && !sedeContainerRef.current.contains(event.target as Node)) {
        setIsSedeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isTipoMenuOpen, isSedeMenuOpen]);

  useEffect(() => {
    if (isSaving) {
      setIsTipoMenuOpen(false);
      setIsSedeMenuOpen(false);
    }
  }, [isSaving]);

  const modalTitle = useMemo(
    () => (mode === "create" ? "Añadir Unidad Móvil" : "Editar Unidad Móvil"),
    [mode]
  );

  const handleTextChange = (field: "name" | "matricula") =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setFormValues((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const toggleSelection = (field: "tipo" | "sede", option: string) => {
    setFormValues((prev) => {
      const currentValues = Array.isArray(prev[field]) ? prev[field] : [];
      const alreadySelected = currentValues.includes(option);
      const updatedValues = alreadySelected
        ? currentValues.filter((value) => value !== option)
        : [...currentValues, option];
      return { ...prev, [field]: updatedValues };
    });
  };

  const openTipoMenu = () => {
    if (!isSaving) {
      setIsSedeMenuOpen(false);
      setIsTipoMenuOpen(true);
    }
  };

  const openSedeMenu = () => {
    if (!isSaving) {
      setIsTipoMenuOpen(false);
      setIsSedeMenuOpen(true);
    }
  };

  const handleTipoFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === " " || event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      openTipoMenu();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setIsTipoMenuOpen(false);
    }
  };

  const handleSedeFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === " " || event.key === "Enter" || event.key === "ArrowDown") {
      event.preventDefault();
      openSedeMenu();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setIsSedeMenuOpen(false);
    }
  };

  const tipoDisplayValue = formValues.tipo.join(", ");
  const sedeDisplayValue = formValues.sede.join(", ");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = formValues.name.trim();
    const trimmedMatricula = formValues.matricula.trim();
    const sanitizedTipo = sanitizeSelection(formValues.tipo, MOBILE_UNIT_TIPO_OPTIONS);
    const sanitizedSede = sanitizeSelection(formValues.sede, MOBILE_UNIT_SEDE_OPTIONS);

    if (!trimmedName || !trimmedMatricula || sanitizedTipo.length === 0 || sanitizedSede.length === 0) {
      setError("Todos los campos son obligatorios");
      return;
    }

    setError(null);
    onSubmit({
      name: trimmedName,
      matricula: trimmedMatricula,
      tipo: sanitizedTipo,
      sede: sanitizedSede,
    });
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
                onChange={handleTextChange("name")}
                disabled={isSaving}
              />
            </Form.Group>
            <Form.Group controlId="mobileUnitMatricula">
              <Form.Label>Matrícula *</Form.Label>
              <Form.Control
                type="text"
                required
                value={formValues.matricula}
                onChange={handleTextChange("matricula")}
                disabled={isSaving}
              />
            </Form.Group>
            <Form.Group controlId="mobileUnitTipo">
              <Form.Label>Tipo *</Form.Label>
              <div ref={tipoContainerRef} className="position-relative">
                <Form.Control
                  type="text"
                  value={tipoDisplayValue}
                  placeholder="Selecciona uno o varios tipos"
                  readOnly
                  required
                  onClick={openTipoMenu}
                  onFocus={openTipoMenu}
                  onKeyDown={handleTipoFieldKeyDown}
                  disabled={isSaving}
                  aria-haspopup="listbox"
                  aria-expanded={isTipoMenuOpen}
                  role="combobox"
                />
                {isTipoMenuOpen && (
                  <div className="dropdown-menu show w-100 p-3 shadow" role="listbox" aria-multiselectable="true">
                    {MOBILE_UNIT_TIPO_OPTIONS.map((option, index) => {
                      const optionId = `mobile-unit-tipo-${option.replace(/\s+/g, "-").toLowerCase()}`;
                      return (
                        <Form.Check
                          key={option}
                          id={optionId}
                          type="checkbox"
                          label={option}
                          checked={formValues.tipo.includes(option)}
                          onChange={() => toggleSelection("tipo", option)}
                          className={index !== MOBILE_UNIT_TIPO_OPTIONS.length - 1 ? "mb-2" : undefined}
                          disabled={isSaving}
                          role="option"
                          aria-selected={formValues.tipo.includes(option)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </Form.Group>
            <Form.Group controlId="mobileUnitSede">
              <Form.Label>Sede *</Form.Label>
              <div ref={sedeContainerRef} className="position-relative">
                <Form.Control
                  type="text"
                  value={sedeDisplayValue}
                  placeholder="Selecciona una o varias sedes"
                  readOnly
                  required
                  onClick={openSedeMenu}
                  onFocus={openSedeMenu}
                  onKeyDown={handleSedeFieldKeyDown}
                  disabled={isSaving}
                  aria-haspopup="listbox"
                  aria-expanded={isSedeMenuOpen}
                  role="combobox"
                />
                {isSedeMenuOpen && (
                  <div className="dropdown-menu show w-100 p-3 shadow" role="listbox" aria-multiselectable="true">
                    {MOBILE_UNIT_SEDE_OPTIONS.map((option, index) => {
                      const optionId = `mobile-unit-sede-${option.replace(/\s+/g, "-").toLowerCase()}`;
                      return (
                        <Form.Check
                          key={option}
                          id={optionId}
                          type="checkbox"
                          label={option}
                          checked={formValues.sede.includes(option)}
                          onChange={() => toggleSelection("sede", option)}
                          className={index !== MOBILE_UNIT_SEDE_OPTIONS.length - 1 ? "mb-2" : undefined}
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
