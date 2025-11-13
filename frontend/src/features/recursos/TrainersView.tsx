// frontend/src/features/recursos/TrainersView.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, ButtonGroup, Form, Spinner, Table } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrainerModal, type TrainerFormValues } from "./TrainerModal";
import { createTrainer, fetchTrainers, updateTrainer, type TrainerPayload } from "./api";
import { SEDE_OPTIONS } from "./trainers.constants";
import type { Trainer } from "../../types/trainer";
import { ApiError } from "../../api/client";
import { useDataTable } from "../../hooks/useDataTable";
import { SortableHeader } from "../../components/table/SortableHeader";
import { DataTablePagination } from "../../components/table/DataTablePagination";
import { TrainerDetailsDrawer } from "./TrainerDetailsDrawer";

export type ToastParams = {
  variant: "success" | "danger" | "info";
  message: string;
};

type TrainersViewProps = {
  onNotify: (toast: ToastParams) => void;
};

const EXPIRATION_FIELDS = [
  "revision_medica_caducidad",
  "epis_caducidad",
  "dni_caducidad",
  "carnet_conducir_caducidad",
  "certificado_bombero_caducidad",
] as const satisfies ReadonlyArray<
  keyof Pick<
    Trainer,
    | "revision_medica_caducidad"
    | "epis_caducidad"
    | "dni_caducidad"
    | "carnet_conducir_caducidad"
    | "certificado_bombero_caducidad"
  >
>;

function parseDate(value: string | null): Date | null {
  if (!value) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function getExpirationThreshold(): Date {
  const threshold = new Date();
  threshold.setMonth(threshold.getMonth() + 2);
  return threshold;
}

function hasUpcomingExpiration(trainer: Trainer, threshold: Date): boolean {
  return EXPIRATION_FIELDS.some((field) => {
    const expirationDate = parseDate(trainer[field]);

    if (!expirationDate) return false;

    return expirationDate <= threshold;
  });
}

function buildPayload(values: TrainerFormValues): TrainerPayload {
  const toNullable = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  const toNullableDate = (value: string): string | null => {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  };

  return {
    name: values.name.trim(),
    apellido: toNullable(values.apellido),
    email: toNullable(values.email),
    phone: toNullable(values.phone),
    dni: toNullable(values.dni),
    direccion: toNullable(values.direccion),
    especialidad: toNullable(values.especialidad),
    titulacion: toNullable(values.titulacion),
    activo: values.activo,
    sede: values.sede.filter((value) => SEDE_OPTIONS.includes(value as (typeof SEDE_OPTIONS)[number])),
    revision_medica_caducidad: toNullableDate(values.revision_medica_caducidad),
    epis_caducidad: toNullableDate(values.epis_caducidad),
    dni_caducidad: toNullableDate(values.dni_caducidad),
    carnet_conducir_caducidad: toNullableDate(values.carnet_conducir_caducidad),
    certificado_bombero_caducidad: toNullableDate(values.certificado_bombero_caducidad),
  };
}

function formatError(error: unknown): string {
  if (error instanceof ApiError) {
    return `[${error.code}] ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Se ha producido un error inesperado";
}

function buildFullName(trainer: Trainer): string {
  const parts = [trainer.name, trainer.apellido]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter((part) => part.length > 0);
  return parts.length ? parts.join(" ") : trainer.name;
}

export function TrainersView({ onNotify }: TrainersViewProps) {
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedTrainer, setSelectedTrainer] = useState<Trainer | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [detailTrainer, setDetailTrainer] = useState<Trainer | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const queryClient = useQueryClient();

  const trainersQuery = useQuery({
    queryKey: ["trainers"],
    queryFn: fetchTrainers,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: TrainerPayload) => createTrainer(payload),
    onSuccess: (trainer) => {
      const displayName = buildFullName(trainer);
      onNotify({
        variant: "success",
        message: `Formador/Bombero "${displayName}" creado correctamente.`,
      });
      setShowModal(false);
      setSelectedTrainer(null);
      queryClient.invalidateQueries({ queryKey: ["trainers"] });
    },
    onError: (error: unknown) => {
      onNotify({ variant: "danger", message: formatError(error) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: TrainerPayload }) => updateTrainer(id, payload),
    onSuccess: (trainer) => {
      const displayName = buildFullName(trainer);
      onNotify({
        variant: "success",
        message: `Datos de "${displayName}" actualizados correctamente.`,
      });
      setShowModal(false);
      setSelectedTrainer(null);
      setDetailTrainer((current) =>
        current && current.trainer_id === trainer.trainer_id ? trainer : current,
      );
      queryClient.invalidateQueries({ queryKey: ["trainers"] });
    },
    onError: (error: unknown) => {
      onNotify({ variant: "danger", message: formatError(error) });
    },
  });

  const trainers = trainersQuery.data ?? [];
  const isLoading = trainersQuery.isLoading;
  const isFetching = trainersQuery.isFetching && !trainersQuery.isLoading;

  const filteredTrainers = useMemo(() => {
    const normalizedTerm = searchTerm.trim().toLowerCase();

    return trainers.filter((trainer) => {
      if (statusFilter === "active" && !trainer.activo) return false;
      if (statusFilter === "inactive" && trainer.activo) return false;

      if (!normalizedTerm) return true;

      const name = trainer.name.toLowerCase();
      const lastName = trainer.apellido?.toLowerCase() ?? "";

      return name.includes(normalizedTerm) || lastName.includes(normalizedTerm);
    });
  }, [trainers, searchTerm, statusFilter]);

  const hasFiltersApplied = useMemo(
    () => searchTerm.trim().length > 0 || statusFilter !== "all",
    [searchTerm, statusFilter]
  );

  const expirationThreshold = getExpirationThreshold();

  const handleAddTrainer = () => {
    setSelectedTrainer(null);
    setModalMode("create");
    setShowModal(true);
  };

  const handleOpenDetails = (trainer: Trainer) => {
    setDetailTrainer(trainer);
    setShowDetails(true);
  };

  const handleEditTrainer = (trainer: Trainer) => {
    setSelectedTrainer(trainer);
    setModalMode("edit");
    setShowModal(true);
  };

  const handleDetailsClose = () => {
    setShowDetails(false);
    setDetailTrainer(null);
  };

  const handleModalClose = () => {
    if (createMutation.isPending || updateMutation.isPending) return;
    setShowModal(false);
  };

  const handleSubmit = (values: TrainerFormValues) => {
    const payload = buildPayload(values);

    if (modalMode === "create") {
      createMutation.mutate(payload);
    } else if (selectedTrainer) {
      updateMutation.mutate({ id: selectedTrainer.trainer_id, payload });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const modalInitialData = modalMode === "edit" ? selectedTrainer : null;
  const errorMessage = trainersQuery.error ? formatError(trainersQuery.error) : null;

  const getSortValue = useCallback((trainer: Trainer, column: string) => {
    switch (column) {
      case "nombre":
        return buildFullName(trainer);
      case "especialidad":
        return trainer.especialidad ?? "";
      case "email":
        return trainer.email ?? "";
      default:
        return null;
    }
  }, []);

  const {
    pageItems,
    sortState,
    currentPage,
    totalPages,
    totalItems,
    pageSize,
    requestSort,
    goToPage,
  } = useDataTable(filteredTrainers, {
    getSortValue,
  });

  const subtitle = useMemo(
    () => "Consulta, edita o añade nuevos formadores y bomberos a tu base de datos.",
    []
  );

  useEffect(() => {
    if (!detailTrainer) return;
    const updated = trainers.find((trainer) => trainer.trainer_id === detailTrainer.trainer_id);
    if (updated && updated !== detailTrainer) {
      setDetailTrainer(updated);
    }
  }, [trainers, detailTrainer]);

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Formadores / Bomberos</h1>
          <p className="text-muted mb-0">{subtitle}</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {(isFetching || isSaving) && (
            <Spinner animation="border" role="status" size="sm" className="me-1" />
          )}
          <Button onClick={handleAddTrainer} disabled={isSaving}>
            Añadir Formador/Bombero
          </Button>
        </div>
      </section>

      {errorMessage && (
        <Alert variant="danger" className="mb-0">
          {errorMessage}
        </Alert>
      )}

      <div className="bg-white rounded-4 shadow-sm">
        <div className="p-3 border-bottom d-flex flex-column flex-md-row gap-3 align-items-md-center justify-content-between">
          <Form.Control
            type="search"
            placeholder="Buscar por nombre o apellido"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
          <ButtonGroup>
            <Button
              variant={statusFilter === "all" ? "primary" : "outline-primary"}
              onClick={() => setStatusFilter("all")}
              active={statusFilter === "all"}
            >
              Todos
            </Button>
            <Button
              variant={statusFilter === "active" ? "primary" : "outline-primary"}
              onClick={() => setStatusFilter("active")}
              active={statusFilter === "active"}
            >
              Activos
            </Button>
            <Button
              variant={statusFilter === "inactive" ? "primary" : "outline-primary"}
              onClick={() => setStatusFilter("inactive")}
              active={statusFilter === "inactive"}
            >
              Inactivos
            </Button>
          </ButtonGroup>
        </div>
        <div className="table-responsive">
          <Table hover className="mb-0 align-middle">
            <thead>
              <tr className="text-muted text-uppercase small">
                <SortableHeader
                  columnKey="nombre"
                  label={<span className="fw-semibold">Nombre</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="especialidad"
                  label={<span className="fw-semibold">Especialidad</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="email"
                  label={<span className="fw-semibold">Email</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <th className="text-end">
                  <span className="fw-semibold">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : totalItems ? (
                pageItems.map((trainer) => {
                  const fullName = buildFullName(trainer);
                  const shouldHighlightExpiration = hasUpcomingExpiration(
                    trainer,
                    expirationThreshold,
                  );
                  return (
                    <tr
                      key={trainer.trainer_id}
                      role="button"
                      onClick={() => handleOpenDetails(trainer)}
                      className={shouldHighlightExpiration ? "table-danger" : undefined}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="fw-semibold">{fullName}</td>
                      <td>{trainer.especialidad ?? "—"}</td>
                      <td>{trainer.email ?? "—"}</td>
                      <td className="text-end">
                        <div className="d-inline-flex gap-2">
                          <Button
                            variant="link"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleOpenDetails(trainer);
                            }}
                          >
                            Ver perfil
                          </Button>
                          <Button
                            variant="link"
                            size="sm"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleEditTrainer(trainer);
                            }}
                          >
                            Editar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : trainers.length ? (
                <tr>
                  <td colSpan={4} className="py-5 text-center text-muted">
                    {hasFiltersApplied
                      ? "No se encontraron formadores que coincidan con los filtros aplicados."
                      : "No hay formadores registrados todavía."}
                  </td>
                </tr>
              ) : (
                <tr>
                  <td colSpan={4} className="py-5 text-center text-muted">
                    No hay formadores registrados todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
        <DataTablePagination
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          totalItems={totalItems}
          onPageChange={goToPage}
        />
      </div>

      <TrainerModal
        show={showModal}
        mode={modalMode}
        initialData={modalInitialData}
        isSaving={isSaving}
        onClose={handleModalClose}
        onSubmit={handleSubmit}
        onNotify={onNotify}
      />
      <TrainerDetailsDrawer
        trainer={detailTrainer}
        show={showDetails}
        onClose={handleDetailsClose}
        onEdit={(trainer) => {
          handleEditTrainer(trainer);
        }}
        onNotify={onNotify}
      />
    </div>
  );
}
