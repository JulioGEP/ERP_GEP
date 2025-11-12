// frontend/src/features/recursos/TrainerDetailsDrawer.tsx
import { Alert, Badge, Button, Offcanvas, Spinner, Table } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Trainer, TrainerDocument } from "../../types/trainer";
import {
  TRAINER_DOCUMENT_TYPES,
  type TrainerDocumentTypeValue,
} from "./trainers.constants";
import { deleteTrainerDocument, fetchTrainerDocuments } from "./api";
import { ApiError } from "../../api/client";

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

  const trainerId = trainer?.trainer_id ?? null;

  const documentsQuery = useQuery({
    queryKey: ["trainer-documents", trainerId],
    queryFn: () => fetchTrainerDocuments(trainerId!),
    enabled: show && Boolean(trainerId),
    staleTime: 60_000,
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

  const documentsData = documentsQuery.data ?? { documents: [], driveFolderWebViewLink: null };
  const documents = documentsData.documents;
  const driveFolderLink = documentsData.driveFolderWebViewLink;

  const documentsError = documentsQuery.isError ? formatErrorMessage(documentsQuery.error) : null;

  const handleDeleteDocument = (document: TrainerDocument) => {
    if (!window.confirm(`¿Eliminar el documento "${document.file_name ?? document.original_file_name ?? document.id}"?`)) {
      return;
    }
    deleteMutation.mutate(document);
  };

  return (
    <Offcanvas
      show={show}
      onHide={onClose}
      placement="end"
      scroll
      backdrop={false}
      restoreFocus={false}
      style={{ width: "min(95vw, 820px)" }}
    >
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
            </div>
            <div>
              <div className="d-flex align-items-center justify-content-end mb-2">
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
                      <th>Autor</th>
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
                          <td>{document.author ?? '—'}</td>
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
