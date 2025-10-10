import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';

interface BudgetImportModalProps {
  show: boolean;
  /** loading opcional (compat: antes era requerido) */
  isLoading?: boolean;
  /** warnings devueltos por el import (opcionales) */
  resultWarnings?: string[] | null;
  /** id importado para feedback (opcional) */
  resultDealId?: string | null;
  /** error del import (opcional) */
  error?: string | null;

  onClose: () => void;
  onSubmit: (dealId: string) => void;
}

export function BudgetImportModal({
  show,
  isLoading = false,
  resultWarnings = null,
  resultDealId = null,
  error = null,
  onClose,
  onSubmit
}: BudgetImportModalProps) {
  const [dealId, setDealId] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (show) {
      setDealId('');
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [show]);

  function handleHide() {
    if (!isLoading) onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = dealId.trim();
    if (!value || isLoading) return;
    onSubmit(value);
  }

  const hasWarnings = Array.isArray(resultWarnings) && resultWarnings.length > 0;

  return (
    <Modal show={show} onHide={handleHide} centered>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title>Importar presupuesto</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {/* Feedback de resultado */}
          {error && (
            <Alert variant="danger" className="mb-3">
              <div className="fw-semibold">No se pudo importar el presupuesto</div>
              <div className="small">{error}</div>
            </Alert>
          )}

          {resultDealId && !error && (
            <Alert variant={hasWarnings ? 'warning' : 'success'} className="mb-3">
              <div className="fw-semibold">
                {hasWarnings ? 'Importado con avisos' : 'Importado correctamente'}
              </div>
              <div className="small">Presupuesto #{resultDealId}</div>
              {hasWarnings && (
                <ul className="small mb-0 mt-2">
                  {resultWarnings!.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}

          {/* Campo de entrada */}
          <Form.Control
            ref={inputRef}
            placeholder="Añade el número de presupuesto sin puntos ni comas"
            value={dealId}
            onChange={(e) => setDealId(e.target.value)}
            disabled={isLoading}
            autoComplete="off"
          />
        </Modal.Body>

        <Modal.Footer className="border-0 pt-0">
          <Button variant="outline-secondary" onClick={handleHide} disabled={isLoading}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isLoading || !dealId.trim()}>
            {isLoading ? 'Importando…' : 'Importar'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
