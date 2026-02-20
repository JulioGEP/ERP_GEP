// frontend/src/features/recursos/TrainerModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Col, Form, Modal, Row, Spinner } from "react-bootstrap";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Trainer } from "../../types/trainer";
import {
  SEDE_OPTIONS,
  TRAINER_DOCUMENT_TYPES,
  type SedeOption,
  type TrainerDocumentTypeValue,
} from "./trainers.constants";
import { uploadTrainerDocument } from "./api";
import { blobOrFileToBase64 } from "../../utils/base64";
import { formatDateForInput, isDateNearExpiry } from "./trainerDates";

type DateFieldKey =
  | "revision_medica_caducidad"
  | "epis_caducidad"
  | "dni_caducidad"
  | "carnet_conducir_caducidad"
  | "certificado_bombero_caducidad";

const DATE_FIELD_CONFIG: Array<{ key: DateFieldKey; label: string; controlId: string }> = [
  { key: "revision_medica_caducidad", label: "Revisión médica (caducidad)", controlId: "trainerRevisionMedicaCaducidad" },
  { key: "epis_caducidad", label: "Caducidad EPIs", controlId: "trainerEpisCaducidad" },
  { key: "dni_caducidad", label: "Caducidad DNI", controlId: "trainerDniCaducidad" },
  {
    key: "carnet_conducir_caducidad",
    label: "Caducidad carnet de conducir",
    controlId: "trainerCarnetConducirCaducidad",
  },
  {
    key: "certificado_bombero_caducidad",
    label: "Caducidad certificado bombero",
    controlId: "trainerCertificadoBomberoCaducidad",
  },
];

export type TrainerFormValues = {
  name: string;
  apellido: string;
  email: string;
  phone: string;
  dni: string;
  direccion: string;
  especialidad: string;
  titulacion: string;
  contrato_fijo: boolean;
  treintaytres: boolean;
  nomina: string;
  irpf: string;
  ss: string;
  horas_contratadas: string;
  activo: boolean;
  sede: string[];
  revision_medica_caducidad: string;
  epis_caducidad: string;
  dni_caducidad: string;
  carnet_conducir_caducidad: string;
  certificado_bombero_caducidad: string;
};

type TrainerModalProps = {
  show: boolean;
  mode: "create" | "edit";
  initialData?: Trainer | null;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: TrainerFormValues) => void;
  onNotify?: (toast: { variant: "success" | "danger" | "info"; message: string }) => void;
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
  contrato_fijo: false,
  treintaytres: false,
  nomina: "",
  irpf: "",
  ss: "",
  horas_contratadas: "",
  activo: true,
  sede: [],
  revision_medica_caducidad: "",
  epis_caducidad: "",
  dni_caducidad: "",
  carnet_conducir_caducidad: "",
  certificado_bombero_caducidad: "",
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
    contrato_fijo: Boolean(trainer.contrato_fijo),
    treintaytres: Boolean(trainer.treintaytres),
    nomina:
      typeof trainer.nomina === "number" && Number.isFinite(trainer.nomina)
        ? String(trainer.nomina)
        : "",
    irpf:
      typeof trainer.irpf === "number" && Number.isFinite(trainer.irpf)
        ? String(trainer.irpf)
        : "",
    ss:
      typeof trainer.ss === "number" && Number.isFinite(trainer.ss)
        ? String(trainer.ss)
        : "",
    horas_contratadas:
      typeof trainer.horas_contratadas === "number" && Number.isFinite(trainer.horas_contratadas)
        ? String(trainer.horas_contratadas)
        : "",
    activo: trainer.activo ?? false,
    sede: Array.isArray(trainer.sede) ? trainer.sede : [],
    revision_medica_caducidad: formatDateForInput(trainer.revision_medica_caducidad),
    epis_caducidad: formatDateForInput(trainer.epis_caducidad),
    dni_caducidad: formatDateForInput(trainer.dni_caducidad),
    carnet_conducir_caducidad: formatDateForInput(trainer.carnet_conducir_caducidad),
    certificado_bombero_caducidad: formatDateForInput(trainer.certificado_bombero_caducidad),
  };
}

export function TrainerModal({
  show,
  mode,
  initialData,
  isSaving,
  onClose,
  onSubmit,
  onNotify,
}: TrainerModalProps) {
  const [formValues, setFormValues] = useState<TrainerFormValues>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isSedeMenuOpen, setIsSedeMenuOpen] = useState(false);
  const sedeContainerRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedDocumentType, setSelectedDocumentType] = useState<TrainerDocumentTypeValue>(
    TRAINER_DOCUMENT_TYPES[0].value,
  );
  const [selectedDocument, setSelectedDocument] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (show) {
      setFormValues(trainerToFormValues(initialData));
      setError(null);
      setUploadError(null);
      setUploadSuccess(null);
      setSelectedDocument(null);
      if (documentInputRef.current) {
        documentInputRef.current.value = "";
      }
    }
    if (!show) {
      setIsSedeMenuOpen(false);
      setUploadError(null);
      setUploadSuccess(null);
      setSelectedDocument(null);
      if (documentInputRef.current) {
        documentInputRef.current.value = "";
      }
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
      const isBooleanField = field === "activo" || field === "contrato_fijo" || field === "treintaytres";
      const value = isBooleanField ? (event.target as HTMLInputElement).checked : event.target.value;
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

  const trainerId = initialData?.trainer_id ?? null;

  const uploadMutation = useMutation({
    mutationFn: async (params: { file: File; type: TrainerDocumentTypeValue }) => {
      if (!trainerId) {
        throw new Error("trainerId es obligatorio");
      }
      const base64 = await blobOrFileToBase64(params.file);
      return uploadTrainerDocument({
        trainerId,
        documentType: params.type,
        fileName: params.file.name,
        mimeType: params.file.type || undefined,
        fileSize: params.file.size,
        contentBase64: base64,
      });
    },
    onSuccess: () => {
      setSelectedDocument(null);
      if (documentInputRef.current) {
        documentInputRef.current.value = "";
      }
      setUploadError(null);
      setUploadSuccess("Documento subido correctamente.");
      if (trainerId) {
        queryClient.invalidateQueries({ queryKey: ["trainer-documents", trainerId] });
      }
      onNotify?.({ variant: "success", message: "Documento subido correctamente." });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "No se pudo subir el documento.";
      setUploadError(message);
      setUploadSuccess(null);
    },
  });

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
      contrato_fijo: formValues.contrato_fijo,
      treintaytres: formValues.treintaytres,
      nomina: formValues.contrato_fijo ? formValues.nomina.trim() : "",
      irpf: formValues.contrato_fijo ? formValues.irpf.trim() : "",
      ss: formValues.contrato_fijo ? formValues.ss.trim() : "",
      horas_contratadas: formValues.contrato_fijo ? formValues.horas_contratadas.trim() : "",
      sede: formValues.sede.filter((value) => SEDE_OPTIONS.includes(value as (typeof SEDE_OPTIONS)[number])),
    };

    onSubmit(payload);
  };

  const handleDocumentTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedDocumentType(event.target.value as TrainerDocumentTypeValue);
  };

  const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

  const handleDocumentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    setUploadSuccess(null);
    const file = event.target.files?.[0] ?? null;
    if (file && file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError("El archivo no puede superar los 10 MB.");
      event.target.value = "";
      setSelectedDocument(null);
      return;
    }
    setSelectedDocument(file);
  };

  const handleUploadDocument = () => {
    if (!trainerId) {
      setUploadError("Guarda el formador antes de subir documentos.");
      return;
    }
    if (!selectedDocument) {
      setUploadError("Selecciona un archivo para subir.");
      return;
    }
    uploadMutation.mutate({ file: selectedDocument, type: selectedDocumentType });
  };

  const isUploadingDocument = uploadMutation.isPending;

  const documentTypeLabel = useMemo(() => {
    const option = TRAINER_DOCUMENT_TYPES.find((item) => item.value === selectedDocumentType);
    return option?.label ?? selectedDocumentType;
  }, [selectedDocumentType]);

  const formatFileSize = (file: File | null) => {
    if (!file) return "";
    if (file.size < 1024) return `${file.size} B`;
    if (file.size < 1024 * 1024) {
      return `${(file.size / 1024).toFixed(1)} KB`;
    }
    return `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
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
                  maxLength={17}
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
            <Col md={6}>
              <Form.Group controlId="trainerContratoFijo">
                <Form.Label>Contrato fijo</Form.Label>
                <div>
                  <Form.Check
                    type="switch"
                    label={formValues.contrato_fijo ? "Sí" : "No"}
                    checked={formValues.contrato_fijo}
                    onChange={handleChange("contrato_fijo")}
                    disabled={isSaving}
                  />
                </div>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group controlId="trainerTreintaYTres">
                <Form.Label>33 días naturales</Form.Label>
                <div>
                  <Form.Check
                    type="switch"
                    label={formValues.treintaytres ? "Sí" : "No"}
                    checked={formValues.treintaytres}
                    onChange={handleChange("treintaytres")}
                    disabled={isSaving}
                  />
                </div>
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
            {DATE_FIELD_CONFIG.map(({ key, label, controlId }) => {
              const value = formValues[key];
              return (
                <Col md={6} key={key}>
                  <Form.Group controlId={controlId}>
                    <Form.Label>{label}</Form.Label>
                    <Form.Control
                      type="date"
                      value={value}
                      onChange={handleChange(key)}
                      disabled={isSaving}
                      className={isDateNearExpiry(value) ? "text-danger" : undefined}
                    />
                  </Form.Group>
                </Col>
              );
            })}
            {mode === "edit" && (
              <Col md={12}>
                <div className="border-top pt-3 mt-1">
                  <h6 className="mb-3">Documentos</h6>
                  <div className="d-flex flex-column flex-lg-row gap-2">
                    <Form.Select
                      value={selectedDocumentType}
                      onChange={handleDocumentTypeChange}
                      disabled={isUploadingDocument}
                    >
                      {TRAINER_DOCUMENT_TYPES.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Form.Select>
                    <Form.Control
                      ref={documentInputRef}
                      type="file"
                      onChange={handleDocumentChange}
                      disabled={isUploadingDocument}
                    />
                    <Button
                      type="button"
                      onClick={handleUploadDocument}
                      disabled={isUploadingDocument || !trainerId}
                    >
                      {isUploadingDocument ? (
                        <>
                          <Spinner animation="border" size="sm" role="status" className="me-2" />
                          Subiendo...
                        </>
                      ) : (
                        "Subir documento"
                      )}
                    </Button>
                  </div>
                  {uploadError && (
                    <div className="alert alert-danger mt-3 mb-0" role="alert">
                      {uploadError}
                    </div>
                  )}
                  {!uploadError && uploadSuccess && (
                    <div className="alert alert-success mt-3 mb-0" role="alert">
                      {uploadSuccess}
                    </div>
                  )}
                  {!uploadError && selectedDocument && !uploadSuccess && (
                    <div className="text-muted small mt-2">
                      Archivo seleccionado: {selectedDocument.name} ({formatFileSize(selectedDocument)}) – Tipo: {documentTypeLabel}
                    </div>
                  )}
                  {!trainerId && (
                    <div className="alert alert-info mt-3 mb-0" role="alert">
                      Guarda el formador para poder gestionar sus documentos.
                    </div>
                  )}
                </div>
              </Col>
            )}
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
