import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product } from '../../types/product';
import { fetchProducts, syncProductsToHolded, type HoldedSyncResult } from './products.api';
import { ApiError } from '../../api/client';

const PRODUCTS_HOLDED_QUERY_KEY = ['products', 'holded'];

type ToastParams = {
  variant: 'success' | 'danger' | 'info';
  message: string;
};

type ProductsHoldedViewProps = {
  onNotify: (toast: ToastParams) => void;
};

function formatPrice(product: Product): string {
  const value = product.id_price ?? product.price ?? null;
  if (value === null || value === undefined) return '';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(value));
}

function summarizeResults(results: HoldedSyncResult[]): { variant: ToastParams['variant']; message: string } {
  const success = results.filter((item) => item.status === 'success').length;
  const skipped = results.filter((item) => item.status === 'skipped').length;
  const errors = results.filter((item) => item.status === 'error').length;

  const message = `Sincronización completada. Exitosos: ${success}. Omitidos: ${skipped}. Errores: ${errors}.`;
  const variant: ToastParams['variant'] = errors ? 'danger' : 'success';

  return { variant, message };
}

export function ProductsHoldedView({ onNotify }: ProductsHoldedViewProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: PRODUCTS_HOLDED_QUERY_KEY,
    queryFn: fetchProducts,
  });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [modalSteps, setModalSteps] = useState<string[]>([]);
  const [modalErrors, setModalErrors] = useState<string[]>([]);
  const [syncResults, setSyncResults] = useState<HoldedSyncResult[]>([]);

  useEffect(() => {
    if (data?.length) {
      setSelectedIds(new Set(data.map((product) => product.id)));
    } else {
      setSelectedIds(new Set());
    }
  }, [data]);

  const allSelected = useMemo(() => {
    if (!data?.length) return false;
    return selectedIds.size === data.length;
  }, [data, selectedIds]);

  const { mutate: syncHolded, isPending: isSyncing } = useMutation({
    mutationFn: syncProductsToHolded,
    onSuccess: (results) => {
      const summary = summarizeResults(results);
      onNotify(summary);
      setSyncResults(results);
      const errors = results
        .filter((item) => item.status === 'error')
        .map((item) => `Producto ${item.productId}: ${item.message ?? 'Error desconocido'}`);
      setModalErrors(errors);
      setModalSteps((prev) => prev.concat('Sincronización completada. Revisa el detalle a continuación.'));
      void queryClient.invalidateQueries({ queryKey: PRODUCTS_HOLDED_QUERY_KEY });
    },
    onError: (mutationError) => {
      const message =
        mutationError instanceof ApiError
          ? mutationError.message
          : mutationError instanceof Error
          ? mutationError.message
          : 'Error desconocido al sincronizar con Holded';
      onNotify({ variant: 'danger', message });
      setModalErrors([message]);
      setModalSteps((prev) => prev.concat('La sincronización falló antes de completarse.'));
    },
  });

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else if (data?.length) {
      setSelectedIds(new Set(data.map((product) => product.id)));
    }
  };

  const toggleItem = (productId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const startSync = () => {
    const steps = [
      '1. Se envían los IDs seleccionados al endpoint /products-holded.',
      '2. El endpoint ejecuta backend/functions/products-holded.ts para preparar los datos.',
      '3. Se crea/actualiza el producto en Holded y se guarda el id_holded en la base de datos.',
    ];
    setModalSteps(steps);
    setModalErrors([]);
    setSyncResults([]);
    setShowModal(true);
    syncHolded(Array.from(selectedIds));
  };

  if (isLoading) {
    return (
      <div className="d-flex align-items-center justify-content-center py-5">
        <Spinner animation="border" role="status" />
      </div>
    );
  }

  if (isError) {
    const message = error instanceof Error ? error.message : 'Error cargando productos';
    return <Alert variant="danger">{message}</Alert>;
  }

  const hasSelection = selectedIds.size > 0;

  return (
      <div className="d-flex flex-column gap-3">
        <div className="d-flex align-items-center gap-2">
          <Button
            variant="primary"
            disabled={!hasSelection || isSyncing}
            onClick={startSync}
          >
            {isSyncing ? 'Actualizando...' : 'Actualizar Holded'}
          </Button>
          {isFetching && <Spinner size="sm" animation="border" role="status" />}
        </div>

        <Modal show={showModal} onHide={() => setShowModal(false)} size="lg" centered>
          <Modal.Header closeButton>
            <Modal.Title>Actualización de Holded</Modal.Title>
          </Modal.Header>
          <Modal.Body className="d-flex flex-column gap-3">
            <div>
              <strong>Pasos del proceso:</strong>
              <ol className="mb-0">
                {modalSteps.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </div>

            <div>
              <strong>Errores detectados:</strong>
              {modalErrors.length === 0 ? (
                <p className="mb-0">Sin errores reportados.</p>
              ) : (
                <ul className="mb-0">
                  {modalErrors.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              )}
            </div>

            {syncResults.length > 0 && (
              <div>
                <strong>Detalle de sincronización:</strong>
                <Table striped bordered hover size="sm" className="mb-0 mt-2">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Estado</th>
                      <th>Mensaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncResults.map((result) => (
                      <tr key={`${result.productId}-${result.status}`}>
                        <td>{result.productId}</td>
                        <td>{result.status}</td>
                        <td>{result.message ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cerrar
            </Button>
          </Modal.Footer>
        </Modal>

      <div className="table-responsive">
        <Table striped hover size="sm">
          <thead>
            <tr>
              <th style={{ width: '3rem' }}>
                <Form.Check type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>Nombre</th>
              <th>Id_Pipedrive</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Id_Holded</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((product) => (
              <tr key={product.id}>
                <td>
                  <Form.Check
                    type="checkbox"
                    checked={selectedIds.has(product.id)}
                    onChange={() => toggleItem(product.id)}
                  />
                </td>
                <td>{product.name ?? ''}</td>
                <td>{product.id_pipe}</td>
                <td>{product.id_category ?? ''}</td>
                <td>{formatPrice(product)}</td>
                <td>{product.id_holded ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
