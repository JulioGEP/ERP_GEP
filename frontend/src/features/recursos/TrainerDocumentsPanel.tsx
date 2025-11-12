// frontend/src/features/recursos/TrainerDocumentsPanel.tsx
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Button, Form, Spinner, Table } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Trainer, TrainerDocument, TrainerDocumentType } from "../../types/trainer";
import { ApiError } from "../../api/client";
import {
  deleteTrainerDocument,
  fetchTrainerDocuments,
  uploadTrainerDocument,
  type TrainerDocumentUploadInput,
} from "./api";

const DOCUMENT_OPTIONS: Array<{ value: TrainerDocumentType; label: string }> = [
  { value: "curriculum_vitae", label: "Curriculum Vitae" },
  { value: "personales", label: "Personales (DNI, analíticas, etc.)" },
  { value: "certificados", label: "Certificados" },
  { value: "otros", label: "Otros" },
];

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function formatError(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Se ha producido un error inesperado";
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
}

function formatFileSize(value: number | null): string {
  if (!value || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const formatted = unitIndex === 0 ? `${Math.round(size)} ${units[unitIndex]}` : `${size.toFixed(1)} ${units[unitIndex]}`;
  return formatted.replace(".0", "");
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      } else {
        reject(new Error("No se pudo leer el archivo"));
      }
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
    reader.readAsDataURL(file);
  });
}

function buildUploadPayload(params: {
  trainerId: string;
  documentType: TrainerDocumentType;
  file: File;
  base64: string;
}): TrainerDocumentUploadInput {
  return {
    trainerId: params.trainerId,
    documentType: params.documentType,
    fileName: params.file.name,
    mimeType: params.file.type || "application/octet-stream",
    contentBase64: params.base64,
    fileSize: params.file.size,
  };
}

type TrainerDocumentsPanelProps = {
  trainer: Trainer;
  onNotify?: (params: { variant: "success" | "danger" | "info"; message: string }) => void;
};

export function TrainerDocumentsPanel({ trainer, onNotify }: TrainerDocumentsPanelProps) {
  const [selectedType, setSelectedType] = useState<TrainerDocumentType>("curriculum_vitae");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const queryClient = useQueryClient();
  const trainerId = trainer.trainer_id;

  const documentsQuery = useQuery({
    queryKey: ["trainer-documents", trainerId],
    queryFn: () => fetchTrainerDocuments(trainerId),
    enabled: Boolean(trainerId),
    staleTime: 30_000,
  });

  const uploadMutation = useMutation({
    mutationFn: async (payload: TrainerDocumentUploadInput) => uploadTrainerDocument(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trainer-documents", trainerId] });
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (onNotify) {
        onNotify({ variant: "success", message: "Documento subido correctamente." });
      }
    },
    onError: (error: unknown) => {
      setLocalError(formatError(error));
      if (onNotify) {
        onNotify({ variant: "danger", message: formatError(error) });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (document: TrainerDocument) =>
      deleteTrainerDocument({ trainerId, documentId: document.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trainer-documents", trainerId] });
      if (onNotify) {
        onNotify({ variant: "success", message: "Documento eliminado correctamente." });
      }
    },
    onError: (error: unknown) => {
      setLocalError(formatError(error));
      if (onNotify) {
        onNotify({ variant: "danger", message: formatError(error) });
      }
    },
  });

  const isUploading = uploadMutation.isPending;
  const isDeleting = deleteMutation.isPending;
  const isProcessing = isUploading || isDeleting;

  const documents = useMemo(() => documentsQuery.data ?? [], [documentsQuery.data]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setLocalError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError("El archivo supera el tamaño máximo permitido de 10 MB.");
      event.target.value = "";
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  }, []);

  const handleUpload = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedFile) {
        setLocalError("Selecciona un archivo para subir.");
        return;
      }

      try {
        setLocalError(null);
        const base64 = await readFileAsBase64(selectedFile);
        const payload = buildUploadPayload({
          trainerId,
          documentType: selectedType,
          file: selectedFile,
          base64,
        });
        await uploadMutation.mutateAsync(payload);
      } catch (error) {
        const message = formatError(error);
        setLocalError(message);
        if (onNotify) {
          onNotify({ variant: "danger", message });
        }
      }
    },
    [selectedFile, trainerId, selectedType, uploadMutation, onNotify],
  );

  const handleDelete = useCallback(
    (document: TrainerDocument) => {
      if (isProcessing) return;
      deleteMutation.mutate(document);
    },
    [deleteMutation, isProcessing],
  );

  return (
    <section className="mt-4 pt-4 border-top">
      <h2 className="h5 mb-3">Documentos del formador</h2>
      <p className="text-muted">
        Sube y gestiona documentos relacionados con el formador. Los archivos se guardarán automáticamente en Google
        Drive con el tipo seleccionado como prefijo.
      </p>

      {localError && (
        <Alert variant="danger" onClose={() => setLocalError(null)} dismissible>
          {localError}
        </Alert>
      )}

      <Form className="bg-light rounded-3 p-3" onSubmit={handleUpload}>
        <div className="row g-3 align-items-end">
          <div className="col-md-4">
            <Form.Group controlId="trainerDocumentType">
              <Form.Label>Tipo de documento</Form.Label>
              <Form.Select
                value={selectedType}
                onChange={(event) => setSelectedType(event.target.value as TrainerDocumentType)}
                disabled={isUploading}
                required
              >
                {DOCUMENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </div>
          <div className="col-md-5">
            <Form.Group controlId="trainerDocumentFile">
              <Form.Label>Archivo</Form.Label>
              <Form.Control
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                disabled={isUploading}
                required
              />
              <Form.Text className="text-muted">Tamaño máximo permitido: 10 MB.</Form.Text>
            </Form.Group>
          </div>
          <div className="col-md-3 d-flex">
            <Button type="submit" className="ms-auto" disabled={!selectedFile || isUploading}>
              {isUploading ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" /> Subiendo...
                </>
              ) : (
                "Subir documento"
              )}
            </Button>
          </div>
        </div>
      </Form>

      <div className="mt-4">
        {documentsQuery.isLoading ? (
          <div className="d-flex align-items-center gap-2 text-muted">
            <Spinner animation="border" size="sm" />
            <span>Cargando documentos...</span>
          </div>
        ) : documentsQuery.isError ? (
          <Alert variant="danger" className="mb-0">
            {formatError(documentsQuery.error)}
          </Alert>
        ) : documents.length === 0 ? (
          <Alert variant="info" className="mb-0">
            Todavía no hay documentos registrados para este formador.
          </Alert>
        ) : (
          <Table hover responsive className="align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>Tipo</th>
                <th>Documento</th>
                <th>Fecha de subida</th>
                <th className="text-end">Tamaño</th>
                <th className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>{document.document_type_label}</td>
                  <td>
                    {document.drive_web_view_link ? (
                      <a href={document.drive_web_view_link} target="_blank" rel="noreferrer">
                        {document.file_name}
                      </a>
                    ) : (
                      document.file_name
                    )}
                  </td>
                  <td>{formatDate(document.uploaded_at ?? document.created_at)}</td>
                  <td className="text-end">{formatFileSize(document.file_size)}</td>
                  <td className="text-end">
                    <Button
                      variant="outline-danger"
                      size="sm"
                      disabled={isProcessing}
                      onClick={() => handleDelete(document)}
                    >
                      {isDeleting && deleteMutation.variables?.id === document.id ? (
                        <Spinner animation="border" size="sm" />
                      ) : (
                        "Eliminar"
                      )}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </section>
  );
}
