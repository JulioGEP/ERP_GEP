import { useCallback, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Form, ListGroup, Stack } from 'react-bootstrap';
import { ApiError } from '../../api/client';
import { importDeal } from '../presupuestos/api/deals.api';

type ImportStatus = 'pending' | 'uploading' | 'success' | 'error';

type BudgetImportProgress = {
  budgetId: string;
  status: ImportStatus;
  message?: string;
  warnings?: string[];
};

const STATUS_VARIANTS: Record<ImportStatus, string> = {
  pending: 'secondary',
  uploading: 'info',
  success: 'success',
  error: 'danger',
};

const STATUS_LABELS: Record<ImportStatus, string> = {
  pending: 'Pendiente',
  uploading: 'Subiendo',
  success: 'Subido',
  error: 'Error',
};

const DEFAULT_ERROR_MESSAGE = 'No se ha podido importar el presupuesto. Inténtalo de nuevo más tarde.';

export function BulkBudgetImportView() {
  const [rawInput, setRawInput] = useState('');
  const [progress, setProgress] = useState<BudgetImportProgress[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const budgetIds = useMemo(() => {
    return rawInput
      .split(',')
      .map((part) => part.trim())
      .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
  }, [rawInput]);

  const updateStatus = useCallback((budgetId: string, update: Partial<BudgetImportProgress>) => {
    setProgress((current) => {
      return current.map((item) => (item.budgetId === budgetId ? { ...item, ...update } : item));
    });
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!budgetIds.length) {
        return;
      }

      setProgress(budgetIds.map((budgetId) => ({ budgetId, status: 'pending' })));
      setIsRunning(true);

      for (const budgetId of budgetIds) {
        updateStatus(budgetId, { status: 'uploading', message: 'Subiendo' });
        try {
          const result = await importDeal(budgetId);
          updateStatus(budgetId, {
            status: 'success',
            message: 'Subido',
            warnings: result.warnings?.filter((warning) => warning.trim().length > 0),
          });
        } catch (error) {
          const defaultMessage = DEFAULT_ERROR_MESSAGE;
          const message = error instanceof ApiError ? error.message || defaultMessage : defaultMessage;
          updateStatus(budgetId, { status: 'error', message });
        }
      }

      setIsRunning(false);
    },
    [budgetIds, updateStatus],
  );

  return (
    <Stack gap={4}>
      <div>
        <h1 className="h3 mb-2">Importar en bucle</h1>
        <p className="text-muted mb-0">
          Introduce varios presupuestos separados por comas. Se importarán uno a uno desde Pipedrive y se
          mostrará el seguimiento sin abrir modales.
        </p>
      </div>

      <Card>
        <Card.Body>
          <Form onSubmit={handleSubmit} className="d-flex flex-column gap-3">
            <Form.Group controlId="bulk-budget-import-input">
              <Form.Label>Presupuestos</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                placeholder="Ejemplo: 1234, 5678, 9012"
                value={rawInput}
                onChange={(event) => setRawInput(event.target.value)}
                disabled={isRunning}
              />
              <Form.Text className="text-muted">
                Separa cada presupuesto con una coma. Los duplicados se eliminarán automáticamente.
              </Form.Text>
            </Form.Group>

            <div className="d-flex gap-2 flex-wrap">
              <Button type="submit" disabled={!budgetIds.length || isRunning}>
                Importar bucle
              </Button>
              {isRunning && (
                <Badge bg="info" text="dark">
                  Procesando importaciones...
                </Badge>
              )}
            </div>
          </Form>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <h2 className="h5">Seguimiento</h2>
          {!progress.length ? (
            <Alert variant="secondary" className="mb-0">
              Aún no hay importaciones en curso. Añade presupuestos y pulsa "Importar bucle" para comenzar.
            </Alert>
          ) : (
            <ListGroup variant="flush" className="mt-3">
              {progress.map((item) => (
                <ListGroup.Item key={item.budgetId} className="d-flex flex-column flex-md-row">
                  <div className="flex-grow-1">
                    <div className="fw-semibold">Presupuesto {item.budgetId}</div>
                    {item.message && <div className="text-muted small mt-1">{item.message}</div>}
                    {item.warnings && item.warnings.length > 0 && (
                      <Alert variant="warning" className="mb-0 mt-2">
                        <div className="fw-semibold">Avisos</div>
                        <ul className="mb-0 ps-3">
                          {item.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </Alert>
                    )}
                  </div>
                  <div className="mt-2 mt-md-0">
                    <Badge bg={STATUS_VARIANTS[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Card.Body>
      </Card>
    </Stack>
  );
}

export default BulkBudgetImportView;
