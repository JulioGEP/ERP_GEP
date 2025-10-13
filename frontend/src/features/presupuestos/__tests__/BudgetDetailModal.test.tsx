import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BudgetDetailModal } from '../BudgetDetailModal';
import type { DealDetail, DealDetailViewModel, DealSummary } from '../../../types/deal';

const summaryFixtures: Record<string, DealSummary> = {
  A: {
    deal_id: 'A',
    title: 'Presupuesto A',
    training_address: 'Calle A 123',
    sede_label: 'Sede Central A',
    caes_label: 'CAES A',
    fundae_label: 'FUNDAE A',
    hotel_label: 'Hotel A',
    alumnos: 10,
    organization: { name: 'Organización A' },
    person: {
      first_name: 'Ana',
      last_name: 'López',
      email: 'ana@example.com',
      phone: '600111222'
    }
  },
  B: {
    deal_id: 'B',
    title: 'Presupuesto B',
    training_address: 'Calle B 456',
    sede_label: 'Sede Central B',
    caes_label: 'CAES B',
    fundae_label: 'FUNDAE B',
    hotel_label: 'Hotel B',
    alumnos: 8,
    organization: { name: 'Organización B' },
    person: {
      first_name: 'Bruno',
      last_name: 'Pérez',
      email: 'bruno@example.com',
      phone: '600333444'
    }
  }
};

const detailFixtures: Record<string, DealDetail> = {
  A: {
    deal_id: 'A',
    title: 'Presupuesto A',
    training_address: 'Calle A 123',
    sede_label: 'Sede Central A',
    caes_label: 'CAES A',
    fundae_label: 'FUNDAE A',
    hotel_label: 'Hotel A',
    alumnos: 10,
    organization: { name: 'Organización A' },
    person: {
      first_name: 'Ana',
      last_name: 'López',
      email: 'ana@example.com',
      phone: '600111222'
    },
    products: [],
    notes: [],
    documents: []
  },
  B: {
    deal_id: 'B',
    title: 'Presupuesto B',
    training_address: 'Calle B 456',
    sede_label: 'Sede Central B',
    caes_label: 'CAES B',
    fundae_label: 'FUNDAE B',
    hotel_label: 'Hotel B',
    alumnos: 8,
    organization: { name: 'Organización B' },
    person: {
      first_name: 'Bruno',
      last_name: 'Pérez',
      email: 'bruno@example.com',
      phone: '600333444'
    },
    products: [],
    notes: [],
    documents: []
  }
};

vi.mock('../api', () => {
  return {
    fetchDealDetail: vi.fn(async (dealId: string) => {
      await Promise.resolve();
      const detail = detailFixtures[dealId];
      if (!detail) {
        throw new Error(`Deal ${dealId} not found`);
      }
      return JSON.parse(JSON.stringify(detail));
    }),
    patchDealEditable: vi.fn(),
    importDeal: vi.fn(),
    getDocPreviewUrl: vi.fn(),
    uploadManualDocument: vi.fn(),
    deleteDocument: vi.fn(),
    buildDealDetailViewModel: vi.fn(
      (deal: DealDetail | null, summary: DealSummary | null): DealDetailViewModel => {
        const source = deal ?? summary;
        if (!source) {
          return {
            dealId: '',
            title: null,
            organizationName: null,
            clientName: null,
            clientEmail: null,
            clientPhone: null,
            pipelineLabel: null,
            trainingAddress: null,
            productName: null,
            hours: null,
            alumnos: null,
            sedeLabel: null,
            caesLabel: null,
            fundaeLabel: null,
            hotelLabel: null,
            products: [],
            notes: []
          };
        }

        const person = source.person ?? null;
        const clientName = person
          ? [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || null
          : null;

        return {
          dealId: source.deal_id,
          title: source.title ?? null,
          organizationName: source.organization?.name ?? null,
          clientName,
          clientEmail: person?.email ?? null,
          clientPhone: person?.phone ?? null,
          pipelineLabel: source.pipeline_label ?? null,
          trainingAddress: source.training_address ?? null,
          productName: null,
          hours: source.hours ?? null,
          alumnos: source.alumnos ?? null,
          sedeLabel: source.sede_label ?? null,
          caesLabel: source.caes_label ?? null,
          fundaeLabel: source.fundae_label ?? null,
          hotelLabel: source.hotel_label ?? null,
          products: deal?.products ?? summary?.products ?? [],
          notes:
            deal?.notes?.map((note) => ({
              id: note.id ?? null,
              content: note.content ?? '',
              author: note.author ?? null
            })) ?? []
        };
      }
    ),
    createDealNote: vi.fn(),
    updateDealNote: vi.fn(),
    deleteDealNote: vi.fn(),
    isApiError: () => false
  };
});

describe('BudgetDetailModal unsaved warning', () => {
  beforeEach(() => {
    cleanup();
  });

  function renderWithProviders(children: ReactNode, client?: QueryClient) {
    const queryClient =
      client ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    return {
      queryClient,
      ...render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>)
    };
  }

  function Wrapper() {
    const [selectedDeal, setSelectedDeal] = useState<string | null>(null);

    const summary = selectedDeal ? summaryFixtures[selectedDeal] : null;

    return (
      <div>
        <button type="button" onClick={() => setSelectedDeal('A')}>
          Abrir A
        </button>
        <button type="button" onClick={() => setSelectedDeal('B')}>
          Abrir B
        </button>
        <BudgetDetailModal dealId={selectedDeal} summary={summary} onClose={() => setSelectedDeal(null)} />
      </div>
    );
  }

  it('clears the unsaved changes dialog when discarding and opening another budget', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<Wrapper />);

    await user.click(screen.getByRole('button', { name: 'Abrir A' }));

    await waitFor(() => expect(screen.queryByText('Cargando…')).not.toBeInTheDocument());

    const addressInput = await screen.findByDisplayValue('Calle A 123');
    await user.clear(addressInput);
    await user.type(addressInput, 'Nueva dirección A');

    const closeButtons = screen.getAllByRole('button', { name: 'Cerrar' });
    await user.click(closeButtons[0]);

    const confirmModal = await screen.findByRole('dialog', { name: 'Cambios sin guardar' });
    await user.click(within(confirmModal).getByRole('button', { name: 'Salir sin guardar' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Cambios sin guardar' })).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Abrir B' }));

    await waitFor(() => expect(screen.queryByText('Cargando…')).not.toBeInTheDocument());
    await screen.findByDisplayValue('Calle B 456');

    expect(screen.queryByRole('dialog', { name: 'Cambios sin guardar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar Cambios' })).toBeNull();

    queryClient.clear();
  });

  it('resets dirty state when switching to another budget while the modal is open', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithProviders(<Wrapper />);

    await user.click(screen.getByRole('button', { name: 'Abrir A' }));
    await waitFor(() => expect(screen.queryByText('Cargando…')).not.toBeInTheDocument());

    const addressInput = await screen.findByDisplayValue('Calle A 123');
    await user.clear(addressInput);
    await user.type(addressInput, 'Dirección modificada');

    expect(await screen.findByRole('button', { name: 'Guardar Cambios' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Abrir B' }));

    await waitFor(() => expect(screen.queryByText('Cargando…')).not.toBeInTheDocument());
    await screen.findByDisplayValue('Calle B 456');

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Guardar Cambios' })).toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Cambios sin guardar' })).toBeNull();

    queryClient.clear();
  });
});
