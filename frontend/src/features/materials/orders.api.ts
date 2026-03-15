// frontend/src/features/materials/orders.api.ts
import { delJson, getJson, postJson } from '../../api/client';
import type { MaterialOrder, MaterialOrdersResponse, MaterialOrderProduct } from '../../types/materialOrder';

export type CreateMaterialOrderPayload = {
  orderNumber?: number;
  supplierName?: string | null;
  supplierEmail: string;
  supplierCc?: string[];
  supplierSubject: string;
  supplierBody: string;
  logisticsTo?: string[];
  logisticsCc?: string[];
  logisticsSubject?: string | null;
  logisticsBody?: string | null;
  products: MaterialOrderProduct[];
  sourceBudgetIds: string[];
  notes?: string | null;
  textoPedido?: string | null;
  pedidoRealizado?: boolean;
  pedidoRecibido?: boolean;
};

export async function fetchMaterialOrders() {
  return getJson<MaterialOrdersResponse>('/api/material-orders');
}

export async function createMaterialOrder(payload: CreateMaterialOrderPayload) {
  return postJson<{ order: MaterialOrder; nextOrderNumber: number }>('/api/material-orders', payload);
}

export async function deleteMaterialOrder(orderId: number) {
  return delJson<{ deleted: true; id: number }>('/api/material-orders', { id: orderId });
}
