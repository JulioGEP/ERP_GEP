import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';

interface BudgetImportModalProps {
  show: boolean;
  isLoading: boolean;
  onClose: () => void;
  onSubmit: (dealId: string) => void;
}

export function BudgetImportModal({ show, isLoading, onClose, onSubmit }: BudgetImportModalProps) {
  const [dealId, setDealId] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (show) {
      setTimeout(() => inputRef.current?.focus(), 180);
    }
  }, [show]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dealId.trim()) {
      return;
    }
    onSubmit(dealId.trim());
  };

  const handleHide = () => {
    setDealId('');
    onClose();
  };

  return (
    <Modal show={show} onHide={handleHide} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton className="border-0 pb-0">
          <Modal.Title className="fw-semibold text-uppercase">Importar presupuesto</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group controlId="dealId">
            <Form.Label className="fw-semibold">Presupuesto (dealId)</Form.Label>
            <Form.Control
              ref={inputRef}
              type="text"
              placeholder="Ej. 7222"
              value={dealId}
              onChange={(event) => setDealId(event.target.value)}
              disabled={isLoading}
              autoComplete="off"
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="outline-secondary" onClick={handleHide} disabled={isLoading}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isLoading || !dealId.trim()}>
            {isLoading ? 'Importando…' : 'Importar presupuesto'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
