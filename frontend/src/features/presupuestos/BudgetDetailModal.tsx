import { Alert, Badge, Modal, Spinner } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import { fetchDealDetail } from './api';
import type { DealSummary } from '../../types/deal';

interface BudgetDetailModalProps {
  dealId: number | null;
  summary: DealSummary | null;
  onClose: () => void;
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function getTrainingNames(budget: DealSummary | null): string[] {
  if (!budget) return [];
  if (Array.isArray(budget.trainingNames) && budget.trainingNames.length) {
    return budget.trainingNames;
  }
  if (Array.isArray(budget.training) && budget.training.length) {
    return budget.training
      .map((product) => (product.name ?? product.code ?? '')?.toString().trim())
      .filter((value): value is string => Boolean(value));
  }
  return [];
}

export function BudgetDetailModal({ dealId, summary, onClose }: BudgetDetailModalProps) {
  const detailQuery = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => fetchDealDetail(dealId as number),
    enabled: typeof dealId === 'number',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    retry: 0,
    staleTime: Infinity
  });

  const deal = detailQuery.data ?? summary;
  const isLoading = detailQuery.isFetching && !detailQuery.data;
  const hasError = Boolean(detailQuery.error);
  const errorMessage = detailQuery.error instanceof Error ? detailQuery.error.message : 'No se pudieron cargar los detalles.';

  const trainingNames = getTrainingNames(deal);
  const prodExtraNames = Array.isArray(deal?.prodExtraNames) ? deal?.prodExtraNames : [];
  const documents = Array.isArray(deal?.documents) ? deal?.documents : [];
  const documentsUrls = Array.isArray(deal?.documentsUrls) ? deal?.documentsUrls : [];
  const notes = Array.isArray(deal?.notes) ? deal?.notes : [];
  const participants = Array.isArray(deal?.participants) ? deal?.participants : [];

  const documentEntries = documents.map((title, index) => ({
    title,
    url: documentsUrls[index] ?? null
  }));

  const showModal = typeof dealId === 'number';

  return (
    <Modal show={showModal} onHide={onClose} centered size="lg">
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title className="fw-semibold text-uppercase">
          {deal ? `Presupuesto #${deal.dealId}` : 'Presupuesto'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-grid gap-3">
        {isLoading ? (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner animation="border" size="sm" />
            <span>Obteniendo datos del presupuesto…</span>
          </div>
        ) : null}

        {hasError ? (
          <Alert variant="danger" className="mb-0">
            {errorMessage}
          </Alert>
        ) : null}

        {deal ? (
          <div className="d-grid gap-4">
            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Resumen</h6>
              <p className="mb-1 fw-semibold">{deal.title}</p>
              <p className="mb-0 text-muted">{deal.organizationName}</p>
            </section>

            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Organización</h6>
              <dl className="row mb-0 small">
                <dt className="col-sm-4 text-muted">CIF</dt>
                <dd className="col-sm-8">{deal.organizationCif ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">Teléfono</dt>
                <dd className="col-sm-8">{deal.organizationPhone ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">Dirección</dt>
                <dd className="col-sm-8">{deal.organizationAddress ?? '—'}</dd>
              </dl>
            </section>

            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Sede</h6>
              <p className="mb-0">{deal.sede ?? '—'}</p>
            </section>

            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Formación</h6>
              {trainingNames.length ? (
                <div className="d-flex flex-wrap gap-2">
                  {trainingNames.map((training) => (
                    <Badge bg="light" text="dark" key={training} className="px-3 py-2 rounded-pill border">
                      {training}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mb-0 text-muted">Sin productos formativos vinculados.</p>
              )}
              {prodExtraNames.length ? (
                <div className="d-flex flex-wrap gap-2 mt-3">
                  {prodExtraNames.map((extra) => (
                    <Badge bg="secondary" key={extra} className="px-3 py-2 rounded-pill">
                      Extra: {extra}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </section>

            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Detalles operativos</h6>
              <dl className="row mb-0 small">
                <dt className="col-sm-4 text-muted">Tipo de formación</dt>
                <dd className="col-sm-8">{deal.trainingType ?? 'Pendiente de sincronizar'}</dd>
                <dt className="col-sm-4 text-muted">Horas</dt>
                <dd className="col-sm-8">{deal.hours ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">Dirección</dt>
                <dd className="col-sm-8">{deal.dealDirection ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">CAE</dt>
                <dd className="col-sm-8">{deal.caes ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">FUNDAE</dt>
                <dd className="col-sm-8">{deal.fundae ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">Hotel / pernocta</dt>
                <dd className="col-sm-8">{deal.hotelNight ?? '—'}</dd>
              </dl>
            </section>

            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Documentos</h6>
              {documentEntries.length ? (
                <ul className="mb-0 small">
                  {documentEntries.map((document, index) => (
                    <li key={`${document.title}-${index}`}>
                      {document.url ? (
                        <a href={document.url} target="_blank" rel="noreferrer">
                          {document.title}
                        </a>
                      ) : (
                        document.title
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-0 text-muted">Aún no hay documentos asociados.</p>
              )}
            </section>

            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Notas</h6>
              {notes.length ? (
                <ul className="mb-0 small">
                  {notes.map((note, index) => (
                    <li key={`${note}-${index}`}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="mb-0 text-muted">Aún no hay notas asociadas.</p>
              )}
            </section>

            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Participantes</h6>
              {participants.length ? (
                <ul className="mb-0 small">
                  {participants.map((participant, index) => (
                    <li key={`${participant.personId}-${index}`}>
                      <span className="fw-semibold">{participant.firstName} {participant.lastName}</span>
                      {participant.role ? ` · ${participant.role}` : ''}
                      {participant.email ? ` · ${participant.email}` : ''}
                      {participant.phone ? ` · ${participant.phone}` : ''}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-0 text-muted">No hay participantes registrados.</p>
              )}
            </section>

            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Trazabilidad</h6>
              <dl className="row mb-0 small">
                <dt className="col-sm-4 text-muted">Deal ID</dt>
                <dd className="col-sm-8">{deal.dealId}</dd>
                <dt className="col-sm-4 text-muted">Organización ID</dt>
                <dd className="col-sm-8">{deal.dealOrgId}</dd>
                <dt className="col-sm-4 text-muted">Creado</dt>
                <dd className="col-sm-8">{formatDate(deal.createdAt)}</dd>
                <dt className="col-sm-4 text-muted">Actualizado</dt>
                <dd className="col-sm-8">{formatDate(deal.updatedAt)}</dd>
              </dl>
            </section>
          </div>
        ) : (
          <p className="mb-0 text-muted">Selecciona un presupuesto para ver su detalle.</p>
        )}
      </Modal.Body>
    </Modal>
  );
}
