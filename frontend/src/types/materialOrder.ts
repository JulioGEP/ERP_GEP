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
  sentFrom: string | null;
};

export type MaterialOrdersResponse = {
  orders: MaterialOrder[];
  nextOrderNumber: number;
};
