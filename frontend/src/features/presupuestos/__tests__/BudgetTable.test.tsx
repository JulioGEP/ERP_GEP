import { afterEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BudgetTable } from '../BudgetTable';
import { DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY } from '../queryKeys';
import type { DealSummary } from '../../../types/deal';

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

const fallbackBudget: DealSummary = {
  deal_id: '1234',
  dealId: '1234',
  title: 'Formación Seguridad',
  pipeline_label: 'Formación Empresa',
  pipeline_id: '1',
  training_address: null,
  sede_label: null,
  caes_label: null,
  fundae_label: null,
  hotel_label: null,
  tipo_servicio: null,
  mail_invoice: null,
  comercial: null,
  a_fecha: '2024-01-01',
  w_id_variation: null,
  presu_holded: null,
  modo_reserva: null,
  hours: null,
  organization: { name: 'Acme Corp' },
  person: { first_name: 'Alice', last_name: 'Smith' },
  products: [],
  productNames: ['Curso PRL'],
  sessions: [],
};

describe('BudgetTable fallback behaviour', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders cached fallback data without performing new requests', async () => {
    const client = createQueryClient();
    client.setQueryData(DEALS_WITHOUT_SESSIONS_FALLBACK_QUERY_KEY, [fallbackBudget]);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(
      <QueryClientProvider client={client}>
        <BudgetTable
          budgets={[]}
          isLoading={false}
          isFetching={false}
          error={new Error('Fallo de red')}
          onRetry={vi.fn()}
          onSelect={vi.fn()}
          showFilters={false}
        />
      </QueryClientProvider>,
    );

    expect(
      screen.getByText('Mostrando datos guardados porque no se pudo actualizar la lista.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('#1234')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Formación Seguridad')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useSearchParams: () => {
      const params = new URLSearchParams();
      return [params, vi.fn()] as ReturnType<typeof actual.useSearchParams>;
    },
  };
});
