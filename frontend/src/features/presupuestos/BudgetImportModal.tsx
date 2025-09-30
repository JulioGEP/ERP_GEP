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
    if (!dealId.trim() || isLoading) return;
    onSubmit(dealId.trim());
  }

  return (
    <Modal show={show} onHide={handleHide} centered>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title>Importar presupuesto</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {/* Sin etiqueta redundante */}
          <Form.Control
            ref={inputRef}
            placeholder="Introduce el dealId"
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

