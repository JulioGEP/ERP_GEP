// frontend/src/features/recursos/MobileUnitsView.tsx
import { useMemo, useState } from "react";
import { Alert, Button, Spinner, Table } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MobileUnitModal, type MobileUnitFormValues } from "./MobileUnitModal";
import {
  createMobileUnit,
  fetchMobileUnits,
  updateMobileUnit,
  type MobileUnitPayload,
} from "./mobileUnits.api";
import type { MobileUnit } from "../../types/mobile-unit";
import { ApiError } from "../presupuestos/api";

type ToastParams = {
  variant: "success" | "danger";
  message: string;
};

type MobileUnitsViewProps = {
  onNotify: (toast: ToastParams) => void;
};

function buildPayload(values: MobileUnitFormValues): MobileUnitPayload {
  return {
    name: values.name.trim(),
    matricula: values.matricula.trim(),
    tipo: values.tipo.trim(),
    sede: values.sede.trim(),
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

export function MobileUnitsView({ onNotify }: MobileUnitsViewProps) {
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [selectedUnit, setSelectedUnit] = useState<MobileUnit | null>(null);

  const queryClient = useQueryClient();

  const unitsQuery = useQuery({
    queryKey: ["mobileUnits"],
    queryFn: fetchMobileUnits,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: MobileUnitPayload) => createMobileUnit(payload),
    onSuccess: (unit) => {
      onNotify({
        variant: "success",
        message: `Unidad móvil "${unit.name}" creada correctamente.`,
      });
      setShowModal(false);
      setSelectedUnit(null);
      queryClient.invalidateQueries({ queryKey: ["mobileUnits"] });
    },
    onError: (error: unknown) => {
      onNotify({ variant: "danger", message: formatError(error) });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: MobileUnitPayload }) =>
      updateMobileUnit(id, payload),
    onSuccess: (unit) => {
      onNotify({
        variant: "success",
        message: `Datos de "${unit.name}" actualizados correctamente.`,
      });
      setShowModal(false);
      setSelectedUnit(null);
      queryClient.invalidateQueries({ queryKey: ["mobileUnits"] });
    },
    onError: (error: unknown) => {
      onNotify({ variant: "danger", message: formatError(error) });
    },
  });

  const units = unitsQuery.data ?? [];
  const isLoading = unitsQuery.isLoading;
  const isFetching = unitsQuery.isFetching && !unitsQuery.isLoading;
  const tableRows = units.length;

  const handleAddUnit = () => {
    setSelectedUnit(null);
    setModalMode("create");
    setShowModal(true);
  };

  const handleSelectUnit = (unit: MobileUnit) => {
    setSelectedUnit(unit);
    setModalMode("edit");
    setShowModal(true);
  };

  const handleModalClose = () => {
    if (createMutation.isPending || updateMutation.isPending) return;
    setShowModal(false);
  };

  const handleSubmit = (values: MobileUnitFormValues) => {
    const payload = buildPayload(values);

    if (modalMode === "create") {
      createMutation.mutate(payload);
    } else if (selectedUnit) {
      updateMutation.mutate({ id: selectedUnit.unidad_id, payload });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;
  const modalInitialData = modalMode === "edit" ? selectedUnit : null;
  const errorMessage = unitsQuery.error ? formatError(unitsQuery.error) : null;

  const subtitle = useMemo(
    () => "Consulta, edita o añade nuevas unidades móviles a tu base de datos.",
    []
  );

  return (
    <div className="d-grid gap-4">
      <section className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
        <div>
          <h1 className="h3 fw-bold mb-1">Unidades Móviles</h1>
          <p className="text-muted mb-0">{subtitle}</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          {(isFetching || isSaving) && (
            <Spinner animation="border" role="status" size="sm" className="me-1" />
          )}
          <Button onClick={handleAddUnit} disabled={isSaving}>
            Añadir Unidad Móvil
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
                <th className="fw-semibold">Nombre</th>
                <th className="fw-semibold">Matrícula</th>
                <th className="fw-semibold">Tipo</th>
                <th className="fw-semibold">Sede</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : tableRows ? (
                units.map((unit) => (
                  <tr
                    key={unit.unidad_id}
                    role="button"
                    onClick={() => handleSelectUnit(unit)}
                    style={{ cursor: "pointer" }}
                  >
                    <td className="fw-semibold">{unit.name}</td>
                    <td>{unit.matricula}</td>
                    <td>{unit.tipo}</td>
                    <td>{unit.sede}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="py-5 text-center text-muted">
                    No hay unidades móviles registradas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </Table>
        </div>
      </div>

      <MobileUnitModal
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
