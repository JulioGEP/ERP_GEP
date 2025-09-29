import { Modal, Badge } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';

interface BudgetDetailModalProps {
  budget: DealSummary | null;
  onClose: () => void;
}

export function BudgetDetailModal({ budget, onClose }: BudgetDetailModalProps) {
  return (
    <Modal show={!!budget} onHide={onClose} centered size="lg">
      <Modal.Header closeButton className="border-0 pb-0">
        <Modal.Title className="fw-semibold text-uppercase">
          {budget ? `Presupuesto #${budget.dealId}` : 'Presupuesto'}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {budget ? (
          <div className="d-grid gap-4">
            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Resumen</h6>
              <p className="mb-1 fw-semibold">{budget.title}</p>
              <p className="mb-0 text-muted">{budget.clientName}</p>
            </section>
            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Sede</h6>
              <p className="mb-0">{budget.sede}</p>
            </section>
            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Formación</h6>
              {Array.isArray(budget.trainingNames) && budget.trainingNames.length ? (
                <div className="d-flex flex-wrap gap-2">
                  {budget.trainingNames.map((training) => (
                    <Badge bg="light" text="dark" key={training} className="px-3 py-2 rounded-pill">
                      {training}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mb-0 text-muted">Sin productos formativos vinculados.</p>
              )}
            </section>
            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Detalles operativos</h6>
              <dl className="row mb-0 small">
                <dt className="col-sm-4 text-muted">Tipo de formación</dt>
                <dd className="col-sm-8">{budget.trainingType ?? 'Pendiente de sincronizar'}</dd>
                <dt className="col-sm-4 text-muted">Horas</dt>
                <dd className="col-sm-8">{budget.hours ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">Dirección</dt>
                <dd className="col-sm-8">{budget.dealDirection ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">CAES</dt>
                <dd className="col-sm-8">{budget.caes ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">FUNDAE</dt>
                <dd className="col-sm-8">{budget.fundae ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">Hotel y pernocta</dt>
                <dd className="col-sm-8">{budget.hotelNight ?? '—'}</dd>
                <dt className="col-sm-4 text-muted">Documentos</dt>
                <dd className="col-sm-8">{budget.documentsNum ?? budget.documents?.length ?? 0}</dd>
                <dt className="col-sm-4 text-muted">Notas</dt>
                <dd className="col-sm-8">{budget.notesCount ?? budget.notes?.length ?? 0}</dd>
              </dl>
            </section>
            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Productos extra</h6>
              {Array.isArray(budget.prodExtraNames) && budget.prodExtraNames.length ? (
                <div className="d-flex flex-wrap gap-2">
                  {budget.prodExtraNames.map((extra) => (
                    <Badge bg="light" text="dark" key={extra} className="px-3 py-2 rounded-pill border">
                      {extra}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mb-0 text-muted">Sin productos extra asociados.</p>
              )}
            </section>
            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Documentos</h6>
              {budget.documents && budget.documents.length ? (
                <ul className="mb-0 small">
                  {budget.documents.map((doc) => (
                    <li key={doc}>{doc}</li>
                  ))}
                </ul>
              ) : (
                <p className="mb-0 text-muted">Aún no hay documentos asociados.</p>
              )}
            </section>
            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Notas</h6>
              {budget.notes && budget.notes.length ? (
                <ul className="mb-0 small">
                  {budget.notes.map((note, index) => (
                    <li key={`${note}-${index}`}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="mb-0 text-muted">Aún no hay notas asociadas.</p>
              )}
            </section>
            <section>
              <h6 className="text-uppercase text-muted fw-semibold small">Trazabilidad</h6>
              <dl className="row mb-0 small">
                <dt className="col-sm-4 text-muted">Deal ID</dt>
                <dd className="col-sm-8">{budget.dealId}</dd>
                <dt className="col-sm-4 text-muted">Organización ID</dt>
                <dd className="col-sm-8">{budget.dealOrgId}</dd>
                <dt className="col-sm-4 text-muted">Creado</dt>
                <dd className="col-sm-8">{budget.createdAt ? new Date(budget.createdAt).toLocaleString() : '—'}</dd>
                <dt className="col-sm-4 text-muted">Actualizado</dt>
                <dd className="col-sm-8">{budget.updatedAt ? new Date(budget.updatedAt).toLocaleString() : '—'}</dd>
              </dl>
            </section>
          </div>
        ) : null}
      </Modal.Body>
    </Modal>
  );
}
