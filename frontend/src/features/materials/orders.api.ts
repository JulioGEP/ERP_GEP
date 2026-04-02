// frontend/src/features/materials/orders.api.ts
import { delJson, getJson, patchJson, postJson } from '../../api/client';
import type {
  MaterialOrder,
  MaterialOrderDocument,
  MaterialOrdersResponse,
  MaterialOrderProduct,
} from '../../types/materialOrder';

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
  logisticsAttachments?: Array<{
    filename: string;
    contentType?: string;
    contentBase64: string;
  }>;
  products: MaterialOrderProduct[];
  sourceBudgetIds: string[];
  notes?: string | null;
  textoPedido?: string | null;
  pedidoRealizado?: boolean;
  pedidoRecibido?: boolean;
};

export type MaterialStockNotificationProduct = {
  productName: string;
  quantity: number;
};

export type SendMaterialStockNotificationPayload = {
  budgetId: string;
  products: MaterialStockNotificationProduct[];
  shippingAddress?: string | null;
  salespersonName?: string | null;
  customerFullName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

export async function fetchMaterialOrders() {
  return getJson<MaterialOrdersResponse>('/api/material-orders');
}

export async function createMaterialOrder(payload: CreateMaterialOrderPayload) {
  return postJson<{ order: MaterialOrder; nextOrderNumber: number }>('/api/material-orders', payload);
}

export async function sendMaterialStockNotification(payload: SendMaterialStockNotificationPayload) {
  return postJson<{ sent: true }>('/api/material-stock-notification', payload);
}

export async function deleteMaterialOrder(orderId: number) {
  return delJson<{ deleted: true; id: number }>('/api/material-orders', { id: orderId });
}

export type UpdateMaterialOrderPayload = {
  id: number;
  textoPedido: string | null;
  pedidoRealizado: boolean;
  pedidoRecibido: boolean;
};

export async function updateMaterialOrder(payload: UpdateMaterialOrderPayload) {
  return patchJson<{ order: MaterialOrder }>('/api/material-orders', payload);
}

export async function fetchMaterialOrderDocuments(orderId: number) {
  return getJson<{ documents: MaterialOrderDocument[] }>(`/api/material-order-documents?orderId=${orderId}`);
}

export type UploadMaterialOrderDocumentPayload = {
  orderId: number;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number;
  contentBase64: string;
};

export async function uploadMaterialOrderDocument(payload: UploadMaterialOrderDocumentPayload) {
  return postJson<{ document: MaterialOrderDocument }>('/api/material-order-documents', payload);
}

export async function deleteMaterialOrderDocument(documentId: string) {
  return delJson<{ deleted: true; id: string }>('/api/material-order-documents', { documentId });
}
