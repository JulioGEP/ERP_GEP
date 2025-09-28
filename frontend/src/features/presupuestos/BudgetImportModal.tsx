import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';

interface BudgetImportModalProps {
  show: boolean;
  isLoading: boolean;
  onClose: () => void;
  onSubmit: (federalNumber: string) => void;
}

export function BudgetImportModal({ show, isLoading, onClose, onSubmit }: BudgetImportModalProps) {
  const [federalNumber, setFederalNumber] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (show) {
      setTimeout(() => inputRef.current?.focus(), 180);
    }
  }, [show]);

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!federalNumber.trim()) {
      return;
    }
    onSubmit(federalNumber.trim());
  };

  const handleHide = () => {
    setFederalNumber('');
    onClose();
  };

  return (
    <Modal show={show} onHide={handleHide} centered>
      <Form onSubmit={handleSubmit}>
        <Modal.Header closeButton className="border-0 pb-0">
          <Modal.Title className="fw-semibold text-uppercase">Importar presupuesto</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group controlId="federalNumber">
            <Form.Label className="fw-semibold">Presupuesto</Form.Label>
            <Form.Control
              ref={inputRef}
              type="text"
              placeholder="Ej. 0123"
              value={federalNumber}
              onChange={(event) => setFederalNumber(event.target.value)}
              disabled={isLoading}
              autoComplete="off"
            />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="outline-secondary" onClick={handleHide} disabled={isLoading}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isLoading || !federalNumber.trim()}>
            {isLoading ? 'Importando…' : 'Importar presupuesto'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
