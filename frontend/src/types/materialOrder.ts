export type MaterialOrderEmail = {
  to: string | string[];
  cc: string[];
  subject: string;
  body: string;
};

export type MaterialOrderProduct = {
  productName: string;
  supplierQuantity: number;
  stockQuantity: number;
  totalLabel?: string | null;
};

export type MaterialOrder = {
  id: number;
  orderNumber: number;
  createdAt: string;
  supplierName: string | null;
  supplierEmail: string | null;
  recipientEmail: string | null;
  ccEmails: string[];
  products: {
    items: MaterialOrderProduct[];
    supplierEmail: MaterialOrderEmail;
    logisticsEmail: MaterialOrderEmail | null;
  };
  sourceBudgetIds: string[];
  notes: string | null;
  textoPedido: string | null;
  pedidoRealizado: boolean;
  pedidoRecibido: boolean;
  sentFrom: string | null;
};

export type MaterialOrderDocument = {
  id: string;
  orderId: number;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  driveFileId: string | null;
  driveFileName: string | null;
  driveWebViewLink: string | null;
  driveFolderId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type MaterialOrdersResponse = {
  orders: MaterialOrder[];
  nextOrderNumber: number;
};
