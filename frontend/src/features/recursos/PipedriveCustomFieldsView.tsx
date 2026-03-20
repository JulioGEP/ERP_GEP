import { useMemo } from 'react';
import { Alert, Badge, Button, Card, Col, Row, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchPipedriveCustomFields,
  PIPEDRIVE_CUSTOM_FIELDS_QUERY_KEY,
  syncPipedriveCustomFields,
  type PipedriveCustomField,
} from './pipedriveCustomFields.api';

function formatDateTime(value: string | null): string {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Nunca';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function FieldCard({ field }: { field: PipedriveCustomField }) {
  return (
    <Card className="h-100 shadow-sm">
      <Card.Body className="d-flex flex-column gap-3">
        <div className="d-flex flex-wrap justify-content-between gap-2 align-items-start">
          <div>
            <Card.Title className="mb-1">{field.fieldName}</Card.Title>
            <div className="text-muted small">{field.fieldKey}</div>
          </div>
          <div className="d-flex gap-2 align-items-center">
            <Badge bg="secondary">{field.fieldType ?? '—'}</Badge>
            <Badge bg="light" text="dark">
              {field.options.length} opciones
            </Badge>
          </div>
        </div>

        <div className="text-muted small">Última sincronización: {formatDateTime(field.syncedAt)}</div>

        {field.options.length === 0 ? (
          <Alert variant="warning" className="mb-0">
            Aún no hay opciones guardadas para este campo. Pulsa <strong>Actualizar</strong> para consultarlas en
            Pipedrive.
          </Alert>
        ) : (
          <div className="table-responsive">
            <Table hover size="sm" className="align-middle mb-0">
              <thead>
                <tr>
                  <th style={{ width: "90px" }}>Orden</th>
                  <th>Opción</th>
                  <th style={{ width: "160px" }}>ID</th>
                </tr>
              </thead>
              <tbody>
                {field.options.map((option) => (
                  <tr key={`${field.fieldKey}-${option.id}`}>
                    <td>{option.order}</td>
                    <td>{option.label}</td>
                    <td>
                      <code>{option.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

export function PipedriveCustomFieldsView() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: PIPEDRIVE_CUSTOM_FIELDS_QUERY_KEY,
    queryFn: fetchPipedriveCustomFields,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const syncMutation = useMutation({
    mutationFn: syncPipedriveCustomFields,
    onSuccess: (fields) => {
      queryClient.setQueryData(PIPEDRIVE_CUSTOM_FIELDS_QUERY_KEY, fields);
    },
  });

  const fields = query.data ?? [];
  const lastSyncedAt = useMemo(() => {
    const values = fields
      .map((field) => (field.syncedAt ? new Date(field.syncedAt) : null))
      .filter((value): value is Date => Boolean(value) && !Number.isNaN(value.getTime()));

    if (!values.length) return null;
    return new Date(Math.max(...values.map((value) => value.getTime()))).toISOString();
  }, [fields]);

  const isInitialLoading = query.isLoading;
  const isRefreshing = query.isFetching && !query.isLoading;
  const isSyncing = syncMutation.isPending;
  const errorMessage = (syncMutation.error as Error | null)?.message ?? query.error?.message ?? null;

  return (
    <div className="d-flex flex-column gap-4">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <h1 className="h3 mb-1">Campos Pipe</h1>
          <p className="text-muted mb-0">
            Consulta y guarda en base de datos las opciones de los campos personalizados de Pipedrive usados en el ERP.
          </p>
        </div>

        <div className="d-flex flex-column align-items-md-end gap-2">
          <Button variant="primary" onClick={() => syncMutation.mutate()} disabled={isSyncing}>
            {isSyncing ? (
              <>
                <Spinner size="sm" animation="border" className="me-2" />
                Actualizando...
              </>
            ) : (
              'Actualizar'
            )}
          </Button>
          <div className="text-muted small">Última actualización global: {formatDateTime(lastSyncedAt)}</div>
        </div>
      </div>

      {errorMessage ? <Alert variant="danger">{errorMessage}</Alert> : null}

      {isInitialLoading ? (
        <div className="text-muted d-flex align-items-center gap-2">
          <Spinner animation="border" size="sm" />
          Cargando campos guardados...
        </div>
      ) : (
        <>
          {isRefreshing ? (
            <div className="text-muted small d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" />
              Refrescando datos...
            </div>
          ) : null}

          <Row className="g-3">
            {fields.map((field) => (
              <Col key={field.fieldKey} xs={12} xl={6}>
                <FieldCard field={field} />
              </Col>
            ))}
          </Row>
        </>
      )}
    </div>
  );
}
