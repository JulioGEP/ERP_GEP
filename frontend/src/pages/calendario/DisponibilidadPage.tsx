// frontend/src/pages/calendario/DisponibilidadPage.tsx
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Form, Spinner, Stack } from "react-bootstrap";
import { TrainerAvailabilitySection } from "../../features/recursos/TrainerAvailabilitySection";
import { fetchTrainers } from "../../features/recursos/api";

type TrainerOption = {
  id: string;
  label: string;
};

function formatTrainerName(name: string, apellido: string | null): string {
  return apellido ? `${name} ${apellido}`.trim() : name;
}

export default function DisponibilidadPage() {
  const trainersQuery = useQuery({
    queryKey: ["trainers", "calendar", "fixed-contract"],
    queryFn: fetchTrainers,
    staleTime: 5 * 60 * 1000,
  });

  const trainerOptions = useMemo((): TrainerOption[] => {
    return (trainersQuery.data ?? [])
      .filter((trainer) => trainer.contrato_fijo)
      .map((trainer) => ({
        id: trainer.trainer_id,
        label: formatTrainerName(trainer.name, trainer.apellido),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "es"));
  }, [trainersQuery.data]);

  const [selectedTrainerId, setSelectedTrainerId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedTrainerId && trainerOptions.length) {
      setSelectedTrainerId(trainerOptions[0].id);
    }
  }, [selectedTrainerId, trainerOptions]);

  const handleTrainerChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSelectedTrainerId(value.length ? value : null);
  };

  return (
    <Stack gap={4}>
      <div className="d-flex flex-column gap-1">
        <span className="text-uppercase text-muted small fw-semibold">Calendario</span>
        <h1 className="h3 fw-bold mb-0">Disponibilidad</h1>
        <p className="text-muted mb-0">Solo se muestran los formadores con contrato fijo activo.</p>
      </div>

      {trainersQuery.isLoading ? (
        <div className="d-flex justify-content-center py-5" aria-live="polite">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Cargando…</span>
          </Spinner>
        </div>
      ) : trainersQuery.isError ? (
        <Alert variant="danger" className="d-flex flex-column flex-md-row align-items-md-center gap-3">
          <div>
            <div className="fw-semibold">No se pudo cargar la lista de formadores.</div>
            <div className="small text-muted">Inténtalo de nuevo más tarde.</div>
          </div>
          <div className="ms-md-auto">
            <Form.Text role="status" className="text-danger">
              Recarga la página para intentarlo de nuevo.
            </Form.Text>
          </div>
        </Alert>
      ) : !trainerOptions.length ? (
        <Alert variant="info" className="mb-0">
          No hay formadores con contrato fijo configurados.
        </Alert>
      ) : (
        <Stack gap={3}>
          <Form.Group controlId="trainer-selector">
            <Form.Label className="fw-semibold">Formador</Form.Label>
            <Form.Select value={selectedTrainerId ?? ""} onChange={handleTrainerChange}>
              {trainerOptions.map((trainer) => (
                <option key={trainer.id} value={trainer.id}>
                  {trainer.label}
                </option>
              ))}
            </Form.Select>
          </Form.Group>

          <TrainerAvailabilitySection trainerId={selectedTrainerId ?? undefined} />
        </Stack>
      )}
    </Stack>
  );
}
