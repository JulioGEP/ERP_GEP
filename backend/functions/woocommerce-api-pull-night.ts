import type { Handler } from '@netlify/functions';

import { COMMON_HEADERS, errorResponse, successResponse } from './_shared/response';
import { importWooCompletedOrders } from './reporting-woocommerce-compras';

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: COMMON_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Método no permitido', 405);
  }

  try {
    const result = await importWooCompletedOrders();
    return successResponse({
      message: 'Sincronización automática (franja nocturna) completada.',
      result,
    });
  } catch (error) {
    console.error('[woocommerce-api-pull-night] woo pull failed', error);
    return errorResponse(
      'WOO_PULL_ERROR',
      error instanceof Error ? error.message : 'No se pudo consultar WooCommerce.',
      500,
    );
  }
};
