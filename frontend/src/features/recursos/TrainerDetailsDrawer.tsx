// frontend/src/features/recursos/TrainerDetailsDrawer.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  Alert,
  Badge,
  Button,
  Form,
  Offcanvas,
  Spinner,
  Table,
} from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Trainer, TrainerDocument } from "../../types/trainer";
import {
  TRAINER_DOCUMENT_TYPES,
  type TrainerDocumentTypeValue,
} from "./trainers.constants";
import {
  deleteTrainerDocument,
  fetchTrainerDocuments,
  uploadTrainerDocument,
} from "./api";
import { ApiError } from "../../api/client";
import { blobOrFileToBase64 } from "../../utils/base64";

type TrainerDetailsDrawerProps = {
  trainer: Trainer | null;
  show: boolean;
  onClose: () => void;
  onEdit: (trainer: Trainer) => void;
  onNotify: (toast: { variant: "success" | "danger" | "info"; message: string }) => void;
};

type TrainerDocumentsQueryResult = {
  documents: TrainerDocument[];
  driveFolderWebViewLink: string | null;
};

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILE_SIZE_LABEL = "10 MB";

function formatErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Se ha producido un error inesperado.";
}

function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTimeLabel(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const DOCUMENT_TYPE_LABEL = new Map(
  TRAINER_DOCUMENT_TYPES.map(({ value, label }) => [value, label]),
);

export function TrainerDetailsDrawer({
  trainer,
  show,
  onClose,
  onEdit,
  onNotify,
}: TrainerDetailsDrawerProps) {
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<TrainerDocumentTypeValue>(
    TRAINER_DOCUMENT_TYPES[0].value,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!show) {
      setSelectedFile(null);
      setFormError(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [show]);

  const trainerId = trainer?.trainer_id ?? null;

  const documentsQuery = useQuery({
    queryKey: ["trainer-documents", trainerId],
    queryFn: () => fetchTrainerDocuments(trainerId!),
    enabled: show && Boolean(trainerId),
    staleTime: 60_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!trainerId) {
        throw new ApiError("VALIDATION_ERROR", "trainerId es obligatorio");
      }
      const base64 = await blobOrFileToBase64(file);
      return uploadTrainerDocument({
        trainerId,
        documentType: selectedType,
        fileName: file.name,
        mimeType: file.type || undefined,
        fileSize: file.size,
        contentBase64: base64,
      });
    },
    onSuccess: (result) => {
      queryClient.setQueryData<TrainerDocumentsQueryResult | undefined>(
        ["trainer-documents", trainerId],
        (current) => {
          const documents = [
            result.document,
            ...(current?.documents ?? []),
          ];
          const driveFolderWebViewLink =
            result.driveFolderWebViewLink ?? current?.driveFolderWebViewLink ?? null;
          return { documents, driveFolderWebViewLink };
        },
      );
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      onNotify({ variant: "success", message: "Documento subido correctamente." });
    },
    onError: (error: unknown) => {
      setFormError(formatErrorMessage(error));
    },
    onSettled: () => {
      if (trainerId) {
        queryClient.invalidateQueries({ queryKey: ["trainer-documents", trainerId] });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (document: TrainerDocument) => {
      await deleteTrainerDocument(document.id);
      return document;
    },
    onSuccess: (document) => {
      queryClient.setQueryData<TrainerDocumentsQueryResult | undefined>(
        ["trainer-documents", trainerId],
        (current) => {
          if (!current) return current;
          return {
            documents: current.documents.filter((doc) => doc.id !== document.id),
            driveFolderWebViewLink: current.driveFolderWebViewLink,
          };
        },
      );
      onNotify({ variant: "success", message: "Documento eliminado correctamente." });
    },
    onError: (error: unknown) => {
      onNotify({ variant: "danger", message: formatErrorMessage(error) });
    },
    onSettled: () => {
      if (trainerId) {
        queryClient.invalidateQueries({ queryKey: ["trainer-documents", trainerId] });
      }
    },
  });

  const handleEditClick = () => {
    if (trainer) {
      onEdit(trainer);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFormError(null);
    const file = event.target.files && event.target.files[0] ? event.target.files[0] : null;
    if (file && file.size > MAX_FILE_SIZE_BYTES) {
      setFormError(`El archivo no puede superar ${MAX_FILE_SIZE_LABEL}.`);
      event.target.value = "";
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const handleUploadSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!trainer) {
      setFormError("Selecciona un formador válido.");
      return;
    }
    if (!selectedFile) {
      setFormError("Selecciona un archivo para subir.");
      return;
    }
    uploadMutation.mutate(selectedFile);
  };

  const documentsData = documentsQuery.data ?? { documents: [], driveFolderWebViewLink: null };
  const documents = documentsData.documents;
  const driveFolderLink = documentsData.driveFolderWebViewLink;

  const documentsError = documentsQuery.isError ? formatErrorMessage(documentsQuery.error) : null;
  const isUploading = uploadMutation.isPending;

  const documentTypeLabel = useMemo(() => {
    return DOCUMENT_TYPE_LABEL.get(selectedType) ?? selectedType;
  }, [selectedType]);

  const handleDeleteDocument = (document: TrainerDocument) => {
    if (!window.confirm(`¿Eliminar el documento "${document.file_name ?? document.original_file_name ?? document.id}"?`)) {
      return;
    }
    deleteMutation.mutate(document);
  };

  return (
    <Offcanvas show={show} onHide={onClose} placement="end" scroll backdrop={false} restoreFocus={false}>
      <Offcanvas.Header closeButton>
        <Offcanvas.Title>
          {trainer ? trainer.name : "Detalle de formador"}
        </Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body className="d-flex flex-column gap-4">
        {trainer ? (
          <div className="d-grid gap-2">
            <div className="d-flex align-items-start justify-content-between gap-3">
              <div>
                <h2 className="h5 mb-1">{trainer.name}</h2>
                <p className="text-muted mb-2">
                  {trainer.apellido ? `${trainer.apellido}` : "Sin apellidos"}
                </p>
                <div className="d-flex flex-column gap-1 small text-muted">
                  <span>Email: {trainer.email ?? "—"}</span>
                  <span>Teléfono: {trainer.phone ?? "—"}</span>
                  <span>DNI: {trainer.dni ?? "—"}</span>
                </div>
              </div>
              <Button variant="outline-primary" size="sm" onClick={handleEditClick}>
                Editar datos
              </Button>
            </div>
            <div>
              <h3 className="h6 mb-3">Documentos</h3>
              <Form onSubmit={handleUploadSubmit} className="d-grid gap-3">
                <div className="d-flex flex-column flex-lg-row gap-2">
                  <Form.Select
                    value={selectedType}
                    onChange={(event) => setSelectedType(event.target.value as TrainerDocumentTypeValue)}
                    disabled={isUploading}
                  >
                    {TRAINER_DOCUMENT_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Form.Select>
                  <Form.Control
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileChange}
                    disabled={isUploading}
                  />
                  <Button type="submit" disabled={isUploading || !selectedFile}>
                    {isUploading ? (
                      <>
                        <Spinner animation="border" role="status" size="sm" className="me-2" />
                        Subiendo...
                      </>
                    ) : (
                      "Subir documento"
                    )}
                  </Button>
                </div>
                {formError && (
                  <Alert variant="danger" className="mb-0">
                    {formError}
                  </Alert>
                )}
                {!formError && selectedFile && (
                  <div className="text-muted small">
                    Archivo seleccionado: {selectedFile.name} ({formatFileSize(selectedFile.size)}) – Tipo: {documentTypeLabel}
                  </div>
                )}
              </Form>
            </div>
            <div>
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h4 className="h6 mb-0">Histórico</h4>
                {driveFolderLink && (
                  <Button
                    variant="link"
                    size="sm"
                    href={driveFolderLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Abrir carpeta en Drive
                  </Button>
                )}
              </div>
              {documentsQuery.isLoading ? (
                <div className="text-center py-4">
                  <Spinner animation="border" role="status" />
                </div>
              ) : documentsError ? (
                <Alert variant="danger" className="mb-0">
                  {documentsError}
                </Alert>
              ) : documents.length ? (
                <Table hover responsive size="sm" className="mb-0 align-middle">
                  <thead className="text-muted text-uppercase small">
                    <tr>
                      <th>Tipo</th>
                      <th>Nombre</th>
                      <th>Tamaño</th>
                      <th>Subido</th>
                      <th className="text-end">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => {
                      const typeLabel =
                        DOCUMENT_TYPE_LABEL.get(document.document_type as TrainerDocumentTypeValue) ??
                        document.document_type_label ??
                        document.document_type;
                      const displayName = document.file_name ?? document.original_file_name ?? document.id;
                      return (
                        <tr key={document.id}>
                          <td>
                            <Badge bg="secondary">{typeLabel}</Badge>
                          </td>
                          <td>
                            {document.drive_web_view_link ? (
                              <a href={document.drive_web_view_link} target="_blank" rel="noreferrer">
                                {displayName}
                              </a>
                            ) : (
                              displayName
                            )}
                          </td>
                          <td>{formatFileSize(document.file_size)}</td>
                          <td>{formatDateTimeLabel(document.uploaded_at)}</td>
                          <td className="text-end">
                            <Button
                              variant="outline-danger"
                              size="sm"
                              onClick={() => handleDeleteDocument(document)}
                              disabled={deleteMutation.isPending}
                            >
                              Eliminar
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              ) : (
                <p className="text-muted mb-0">No hay documentos registrados.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="text-muted">Selecciona un formador para ver sus detalles.</div>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
}
