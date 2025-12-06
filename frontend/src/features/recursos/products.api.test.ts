import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchProducts,
  syncProducts,
  updateProduct,
} from './products.api';
import { requestJson } from '../../api/client';

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    requestJson: vi.fn(),
  };
});

const requestJsonMock = requestJson as unknown as Mock;

beforeEach(() => {
  requestJsonMock.mockReset();
});

describe('products.api', () => {
  it('fetchProducts returns normalized products using shared client', async () => {
    requestJsonMock.mockResolvedValue({
      ok: true,
      products: [
        {
          id: '1',
          id_pipe: 'p',
          id_woo: '10',
          name: 'Producto',
          code: 'COD',
          category: 'cat',
          type: 'tipo',
          template: 'tpl',
          url_formacion: 'https://example.com',
          almacen_stock: '12',
          provider_ids: [1, '2'],
          atributos: [
            { nombre: 'Talla', valor: ' L ', cantidad: 3 },
            { nombre: 'Color', valor: 'Rojo', cantidad: '2' },
          ],
          active: true,
          created_at: '2023-01-01T00:00:00.000Z',
          updated_at: '2023-01-02T00:00:00.000Z',
        },
      ],
    });

    const result = await fetchProducts();

    expect(requestJsonMock).toHaveBeenCalledWith(
      '/products',
      undefined,
      expect.objectContaining({
        defaultErrorMessage: 'Error inesperado en la solicitud',
        invalidResponseMessage: 'Respuesta JSON inválida del servidor',
      }),
    );

    expect(result).toHaveLength(1);

    expect(result).toMatchObject([
      {
        id: '1',
        id_pipe: 'p',
        id_woo: 10,
        name: 'Producto',
        code: 'COD',
        category: 'cat',
        type: 'tipo',
        template: 'tpl',
        url_formacion: 'https://example.com',
        almacen_stock: 12,
        provider_ids: [1, 2],
        atributos: [
          { nombre: 'Talla', valor: 'L', cantidad: 3 },
          { nombre: 'Color', valor: 'Rojo', cantidad: 2 },
        ],
        active: true,
        created_at: '2023-01-01T00:00:00.000Z',
        updated_at: '2023-01-02T00:00:00.000Z',
      },
    ]);
  });

  it('updateProduct sends patch payload through shared client', async () => {
    requestJsonMock.mockResolvedValue({
      ok: true,
      product: {
        id: '2',
        id_pipe: 'pipe',
        id_woo: 20,
        name: 'Otro',
        code: 'XYZ',
        category: 'cat2',
        type: 'tipo2',
        template: null,
        url_formacion: null,
        atributos: [],
        almacen_stock: null,
        provider_ids: [],
        active: false,
        created_at: null,
        updated_at: null,
      },
    });

    const result = await updateProduct('2', {
      template: ' tpl ',
      url_formacion: ' https://formacion ',
      active: false,
      id_woo: 30,
    });

    expect(requestJsonMock).toHaveBeenCalledWith(
      '/products/2',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          template: 'tpl',
          url_formacion: 'https://formacion',
          active: false,
          id_woo: 30,
        }),
      }),
      expect.objectContaining({
        defaultErrorMessage: 'Error inesperado en la solicitud',
        invalidResponseMessage: 'Respuesta JSON inválida del servidor',
      }),
    );

    expect(result).toMatchObject({
      id: '2',
      id_woo: 20,
      active: false,
    });
  });

  it('syncProducts posts request using shared client', async () => {
    requestJsonMock.mockResolvedValue({
      ok: true,
      summary: {
        fetched: 1,
        imported: 1,
        created: 0,
        updated: 1,
        deactivated: 0,
      },
    });

    const summary = await syncProducts();

    expect(requestJsonMock).toHaveBeenCalledWith(
      '/products-sync',
      expect.objectContaining({ method: 'POST' }),
      expect.objectContaining({
        defaultErrorMessage: 'Error inesperado en la solicitud',
        invalidResponseMessage: 'Respuesta JSON inválida del servidor',
      }),
    );

    expect(summary).toEqual({
      fetched: 1,
      imported: 1,
      created: 0,
      updated: 1,
      deactivated: 0,
    });
  });
});
