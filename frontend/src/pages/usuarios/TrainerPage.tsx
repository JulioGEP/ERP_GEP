export type TrainerPageProps = Record<string, never>;
export default function TrainerPage(_: TrainerPageProps) {
  return (
    <section className="d-flex flex-column gap-3">
      <header>
        <h1 className="h3 mb-3">Área personal del formador</h1>
        <p className="text-muted mb-0">
          Próximamente podrás gestionar tu planificación y documentación desde aquí.
        </p>
      </header>
    </section>
  );
}
