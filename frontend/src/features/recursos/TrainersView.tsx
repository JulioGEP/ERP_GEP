// frontend/src/features/recursos/TrainersView.tsx
import { useCallback, useMemo, useState } from "react";
import { Alert, Button, Spinner, Table } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TrainerModal, type TrainerFormValues } from "./TrainerModal";
import { createTrainer, fetchTrainers, updateTrainer, type TrainerPayload } from "./api";
import { SEDE_OPTIONS } from "./trainers.constants";
import type { Trainer } from "../../types/trainer";
import { ApiError } from "../presupuestos/api";
import { useDataTable } from "../../hooks/useDataTable";
import { SortableHeader } from "../../components/table/SortableHeader";
import { DataTablePagination } from "../../components/table/DataTablePagination";

type ToastParams = {
  variant: "success" | "danger";
  message: string;
};

type TrainersViewProps = {
  onNotify: (toast: ToastParams) => void;
};

function buildPayload(values: TrainerFormValues): TrainerPayload {
  const toNullable = (value: string): string | null => {
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
      queryClient.invalidateQueries({ queryKey: ["trainers"] });
    },
    onError: (error: unknown) => {
      onNotify({ variant: "danger", message: formatError(error) });
    },
  });

  const trainers = trainersQuery.data ?? [];
  const isLoading = trainersQuery.isLoading;
  const isFetching = trainersQuery.isFetching && !trainersQuery.isLoading;

  const handleAddTrainer = () => {
    setSelectedTrainer(null);
    setModalMode("create");
    setShowModal(true);
  };

  const handleSelectTrainer = (trainer: Trainer) => {
    setSelectedTrainer(trainer);
    setModalMode("edit");
    setShowModal(true);
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
  } = useDataTable(trainers, {
    getSortValue,
  });

  const subtitle = useMemo(
    () => "Consulta, edita o añade nuevos formadores y bomberos a tu base de datos.",
    []
  );

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
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={3} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : totalItems ? (
                pageItems.map((trainer) => {
                  const fullName = buildFullName(trainer);
                  return (
                    <tr
                      key={trainer.trainer_id}
                      role="button"
                      onClick={() => handleSelectTrainer(trainer)}
                      style={{ cursor: "pointer" }}
                    >
                      <td className="fw-semibold">{fullName}</td>
                      <td>{trainer.especialidad ?? "—"}</td>
                      <td>{trainer.email ?? "—"}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={3} className="py-5 text-center text-muted">
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
      />
    </div>
  );
}
