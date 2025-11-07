import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Spinner, Table } from 'react-bootstrap';
import type { DealSummary } from '../../types/deal';
import { fetchProductsWithVariants } from '../formacion_abierta/api';
import type { ActiveVariant, ProductInfo, VariantInfo } from '../formacion_abierta/types';
import { VariantModal } from '../formacion_abierta/ProductVariantsList';

const variantDateFormatter = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
});

function normalizeVariantId(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

function formatVariantDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  try {
    return variantDateFormatter.format(parsed);
  } catch {
    return null;
  }
}

function hasAssignedTrainerId(value: unknown): boolean {
  if (value == null) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasAssignedTrainerId(item));
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return false;
    }
    return value !== 0;
  }

  const trimmed = String(value).trim();
  if (!trimmed.length) {
    return false;
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === '0' || normalized === 'null' || normalized === 'undefined') {
    return false;
  }

  return true;
}

type OpenTrainingUnplannedTableProps = {
  budgets: DealSummary[];
};

type VariantRow = {
  product: ProductInfo;
  variant: VariantInfo;
  deals: DealSummary[];
};

export function OpenTrainingUnplannedTable({ budgets }: OpenTrainingUnplannedTableProps) {
  const productsQuery = useQuery({
    queryKey: ['open-training', 'variants'],
    queryFn: fetchProductsWithVariants,
    staleTime: 5 * 60 * 1000,
  });

  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [activeVariant, setActiveVariant] = useState<ActiveVariant | null>(null);

  useEffect(() => {
    if (productsQuery.data) {
      setProducts(productsQuery.data);
    }
  }, [productsQuery.data]);

  const dealsByVariantId = useMemo(() => {
    const map = new Map<string, DealSummary[]>();
    budgets.forEach((deal) => {
      const variantId = normalizeVariantId(deal.w_id_variation ?? null);
      if (!variantId) {
        return;
      }
      if (!map.has(variantId)) {
        map.set(variantId, []);
      }
      const target = map.get(variantId);
      if (!target) {
        return;
      }
      target.push(deal);
    });
    return map;
  }, [budgets]);

  const variantRows = useMemo<VariantRow[]>(() => {
    if (!products.length) {
      return [];
    }

    const rows: VariantRow[] = [];
    const now = new Date();
    products.forEach((product) => {
      product.variants.forEach((variant) => {
        const status = (variant.status ?? '').trim().toLowerCase();
        if (status !== 'publish') {
          return;
        }
        const variantDateValue = variant.date ? new Date(variant.date) : null;
        if (!variantDateValue || Number.isNaN(variantDateValue.getTime())) {
          return;
        }
        if (variantDateValue.getTime() <= now.getTime()) {
          return;
        }
        const hasTrainer =
          hasAssignedTrainerId(variant.trainer_id) || hasAssignedTrainerId(variant.trainer_ids);
        if (hasTrainer) {
          return;
        }
        const variantId = normalizeVariantId(variant.id_woo ?? variant.id);
        if (!variantId) {
          return;
        }
        const dealsForVariant = dealsByVariantId.get(variantId) ?? [];
        if (!dealsForVariant.length) {
          return;
        }

        const sortedDeals = [...dealsForVariant].sort((a, b) =>
          a.deal_id.localeCompare(b.deal_id, 'es', { sensitivity: 'base' }),
        );
        rows.push({ product, variant, deals: sortedDeals });
      });
    });

    rows.sort((a, b) => {
      const dateA = a.variant.date ? new Date(a.variant.date).getTime() : Number.POSITIVE_INFINITY;
      const dateB = b.variant.date ? new Date(b.variant.date).getTime() : Number.POSITIVE_INFINITY;
      if (Number.isFinite(dateA) || Number.isFinite(dateB)) {
        if (!Number.isFinite(dateA)) return 1;
        if (!Number.isFinite(dateB)) return -1;
        if (dateA !== dateB) return dateA - dateB;
      }
      const productNameA = (a.product.name ?? a.product.code ?? '').trim();
      const productNameB = (b.product.name ?? b.product.code ?? '').trim();
      if (productNameA.length || productNameB.length) {
        const comparison = productNameA.localeCompare(productNameB, 'es', { sensitivity: 'base' });
        if (comparison !== 0) {
          return comparison;
        }
      }
      const variantNameA = (a.variant.name ?? '').trim();
      const variantNameB = (b.variant.name ?? '').trim();
      return variantNameA.localeCompare(variantNameB, 'es', { sensitivity: 'base' });
    });

    return rows;
  }, [dealsByVariantId, products]);

  const handleVariantUpdated = (updatedVariant: VariantInfo) => {
    setProducts((prev) =>
      prev.map((product) => {
        const hasVariant = product.variants.some((item) => item.id === updatedVariant.id);
        if (!hasVariant) {
          return product;
        }
        return {
          ...product,
          variants: product.variants.map((item) =>
            item.id === updatedVariant.id ? { ...item, ...updatedVariant } : item,
          ),
        };
      }),
    );
  };

  const handleSelectVariant = (product: ProductInfo, variant: VariantInfo) => {
    setActiveVariant({ product, variant });
  };

  const handleCloseModal = () => setActiveVariant(null);

  const isLoading = productsQuery.isLoading;
  const isFetching = productsQuery.isFetching;
  const error = productsQuery.error;

  let content;

  if (isLoading) {
    content = (
      <div className="text-center py-5 text-muted bg-white rounded-4 shadow-sm">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="mb-0">Cargando variantes de formación abierta…</p>
      </div>
    );
  } else if (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron cargar las variantes.';
    content = (
      <Alert
        variant="danger"
        className="rounded-4 shadow-sm d-flex flex-column flex-md-row align-items-md-center gap-3"
      >
        <div className="flex-grow-1">
          <p className="fw-semibold mb-1">Error al cargar la formación abierta</p>
          <p className="mb-0 small">{message}</p>
        </div>
      </Alert>
    );
  } else if (!variantRows.length) {
    content = (
      <div className="text-center py-4 text-muted bg-white rounded-4 shadow-sm">
        <p className="mb-1 fw-semibold">No hay formación abierta pendiente.</p>
        <p className="mb-0 small">
          No se encontraron variantes publicadas sin formador asignado.
        </p>
      </div>
    );
  } else {
    content = (
      <div className="rounded-4 shadow-sm bg-white overflow-hidden">
        <div className="table-responsive">
          <Table hover className="mb-0 align-middle">
            <thead>
              <tr>
                <th scope="col">Formación</th>
                <th scope="col" style={{ width: 160 }}>Fecha</th>
                <th scope="col" style={{ width: 200 }}>Sede</th>
                <th scope="col">Presupuestos</th>
              </tr>
            </thead>
            <tbody>
              {variantRows.map(({ product, variant, deals }) => {
                const productLabel = (product.name ?? product.code ?? '').trim() || 'Producto sin nombre';
                const variantLabel = (variant.name ?? '').trim() || 'Variante sin nombre';
                const formattedDate = formatVariantDate(variant.date);
                const sedeLabel = (variant.sede ?? '').trim() || '—';
                return (
                  <tr
                    key={variant.id}
                    role="button"
                    onClick={() => handleSelectVariant(product, variant)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <div className="fw-semibold">{productLabel}</div>
                      <div className="text-muted small">{variantLabel}</div>
                    </td>
                    <td>{formattedDate ?? '—'}</td>
                    <td>{sedeLabel}</td>
                    <td>
                      {deals.length ? (
                        <div className="d-flex flex-wrap gap-2">
                          {deals.map((deal) => {
                            const dealId = deal.deal_id;
                            const title = (deal.title ?? '').trim();
                            return (
                              <Badge
                                key={dealId}
                                bg="primary"
                                className="text-uppercase"
                                title={title.length ? title : undefined}
                              >
                                {dealId}
                              </Badge>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-muted small">Sin presupuestos asociados</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <section className="d-grid gap-3">
      <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2">
        <div>
          <h2 className="h5 fw-semibold mb-1">Formación abierta sin planificar</h2>
          <p className="text-muted small mb-0">Sesión formación abiertas publicadas sin formador asignado y con alumnos en la formación</p>
        </div>
        {isFetching ? (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner animation="border" size="sm" />
            <span>Actualizando…</span>
          </div>
        ) : null}
      </div>

      {content}

      <VariantModal active={activeVariant} onHide={handleCloseModal} onVariantUpdated={handleVariantUpdated} />
    </section>
  );
}
