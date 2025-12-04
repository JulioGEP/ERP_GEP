// frontend/src/features/recursos/MobileUnitsView.tsx
import { type ChangeEvent, useCallback, useMemo, useState } from "react";
import { Alert, Button, Form, Spinner, Table } from "react-bootstrap";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MobileUnitModal, type MobileUnitFormValues } from "./MobileUnitModal";
import {
  createMobileUnit,
  fetchMobileUnits,
  updateMobileUnit,
  type MobileUnitPayload,
} from "./mobileUnits.api";
import {
  MOBILE_UNIT_SEDE_OPTIONS,
  MOBILE_UNIT_TIPO_OPTIONS,
} from "./mobileUnits.constants";
import type { MobileUnit } from "../../types/mobile-unit";
import { ApiError } from "../../api/client";
import { useDataTable } from "../../hooks/useDataTable";
import { SortableHeader } from "../../components/table/SortableHeader";
import { DataTablePagination } from "../../components/table/DataTablePagination";

type ToastParams = {
  variant: "success" | "danger" | "info";
  message: string;
};

type MobileUnitsViewProps = {
  onNotify: (toast: ToastParams) => void;
};

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return new Date(result.getFullYear(), result.getMonth(), result.getDate());
}

function parseDateString(value: string | null): Date | null {
  if (!value || typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed.length) return null;

  const ddMmYyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddMmYyyy) {
    const [, day, month, year] = ddMmYyyy;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const timestamp = Date.parse(trimmed);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function isDateExpiringSoon(value: string | null, threshold: Date): boolean {
  const parsed = parseDateString(value);
  if (!parsed) return false;

  const normalized = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  return normalized <= threshold;
}

function hasExpiringDates(unit: MobileUnit, threshold: Date): boolean {
  return (
    isDateExpiringSoon(unit.itv, threshold) ||
    isDateExpiringSoon(unit.revision, threshold) ||
    isDateExpiringSoon(unit.vigencia_seguro, threshold)
  );
}

function sanitizeSelection(values: string[], allowedValues: readonly string[]) {
  const selections = Array.isArray(values) ? values : [];
  const normalized = selections
    .map((value) => value.trim())
    .filter((value) => value.length);

  const mapped: string[] = [];

  for (const selection of normalized) {
    const match = allowedValues.find((allowed) => allowed.toLowerCase() === selection.toLowerCase());
    if (match && !mapped.includes(match)) {
      mapped.push(match);
    }
  }

  return mapped;
}

function buildPayload(values: MobileUnitFormValues): MobileUnitPayload {
  return {
    name: values.name.trim(),
    matricula: values.matricula.trim(),
    tipo: sanitizeSelection(values.tipo, MOBILE_UNIT_TIPO_OPTIONS),
    sede: sanitizeSelection(values.sede, MOBILE_UNIT_SEDE_OPTIONS),
    activo: values.activo,
    itv: values.itv,
    revision: values.revision,
    tipo_seguro: values.tipo_seguro.trim(),
    vigencia_seguro: values.vigencia_seguro,
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
  const [showInactiveUnits, setShowInactiveUnits] = useState(false);

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

  const filteredUnits = useMemo(
    () => (showInactiveUnits ? units : units.filter((unit) => unit.activo)),
    [showInactiveUnits, units]
  );

  const expirationThreshold = useMemo(() => {
    const today = new Date();
    const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return addMonths(normalizedToday, 1);
  }, []);

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

  const getSortValue = useCallback((unit: MobileUnit, column: string) => {
    switch (column) {
      case "nombre":
        return unit.name;
      case "matricula":
        return unit.matricula;
      case "tipo":
        return unit.tipo.join(", ");
      case "sede":
        return unit.sede.join(", ");
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
  } = useDataTable(filteredUnits, {
    getSortValue,
  });

  const subtitle = useMemo(
    () => "Consulta, edita o añade nuevas unidades móviles a tu base de datos.",
    []
  );

  const toggleUnitActive = useCallback(
    (unit: MobileUnit) => {
      updateMutation.mutate({ id: unit.unidad_id, payload: { activo: !unit.activo } });
    },
    [updateMutation]
  );

  const handleToggleActiveChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>, unit: MobileUnit) => {
      event.stopPropagation();
      toggleUnitActive(unit);
    },
    [toggleUnitActive]
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
          <Button
            variant={showInactiveUnits ? "outline-secondary" : "secondary"}
            onClick={() => setShowInactiveUnits((current) => !current)}
            disabled={isSaving}
          >
            {showInactiveUnits ? "Ocultar unidades inactivas" : "Mostrar todas las unidades"}
          </Button>
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
                <SortableHeader
                  columnKey="nombre"
                  label={<span className="fw-semibold">Nombre</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="matricula"
                  label={<span className="fw-semibold">Matrícula</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="tipo"
                  label={<span className="fw-semibold">Tipo</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <SortableHeader
                  columnKey="sede"
                  label={<span className="fw-semibold">Sede</span>}
                  sortState={sortState}
                  onSort={requestSort}
                />
                <th className="text-center fw-semibold">Activo</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-5 text-center">
                    <Spinner animation="border" role="status" />
                  </td>
                </tr>
              ) : totalItems ? (
                pageItems.map((unit) => (
                  <tr
                    key={unit.unidad_id}
                    role="button"
                    onClick={() => handleSelectUnit(unit)}
                    style={{ cursor: "pointer" }}
                    className={hasExpiringDates(unit, expirationThreshold) ? "table-danger" : undefined}
                  >
                    <td className="fw-semibold">{unit.name}</td>
                    <td>{unit.matricula}</td>
                    <td>{unit.tipo.length ? unit.tipo.join(", ") : "—"}</td>
                    <td>{unit.sede.length ? unit.sede.join(", ") : "—"}</td>
                    <td className="text-center">
                      <Form.Check
                        type="switch"
                        id={`mobile-unit-status-${unit.unidad_id}`}
                        checked={unit.activo}
                        label={unit.activo ? "Activa" : "Inactiva"}
                        className="d-inline-flex align-items-center gap-2"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => handleToggleActiveChange(event, unit)}
                        disabled={isSaving}
                      />
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="py-5 text-center text-muted">
                    No hay unidades móviles registradas todavía.
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
