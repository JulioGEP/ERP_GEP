// frontend/src/types/resource-conflict.ts

export type ResourceConflictDetail = {
  session_id: string;
  deal_id: string;
  deal_title: string | null;
  organization_name: string | null;
  product_code: string | null;
  product_name: string | null;
  inicio: string | null;
  fin: string | null;
};

export type ResourceAvailability = {
  isBusy: boolean;
  conflicts: ResourceConflictDetail[];
};

export type ResourceConflictSummary = {
  resource_type: 'sala' | 'formador' | 'unidad_movil';
  resource_id: string;
  resource_label?: string | null;
  conflicts: ResourceConflictDetail[];
};
