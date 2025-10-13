// frontend/src/types/deal.ts

/* ======================
 * Tipos base (DB / API)
 * ====================== */

export interface DealOrganization {
  org_id?: string | null;
  name?: string | null;
}

export interface DealPerson {
  person_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface DealNote {
  id?: string | null;
  deal_id?: string | null;
  content?: string | null;
  author?: string | null;
  created_at?: string | null; // ISO
}

/* Productos del deal (con horas por producto y comentarios) */
export type DealProductType = "TRAINING" | "EXTRA" | null;

export interface DealProduct {
  id?: string | null;
  deal_id?: string | null;

  name?: string | null;
  code?: string | null;

  quantity?: number | null; // decimal en DB, se normaliza a number en API
  price?: number | null;    // decimal en DB, se normaliza a number en API

  type?: DealProductType;   // enum existente

  // NUEVOS (según migración)
  hours?: number | null;        // entero opcional; si no viene → null
  comments?: string | null;     // comentarios por línea
  typeLabel?: string | null;    // solo para filtros futuros
  categoryLabel?: string | null;
}

/* Documentos unificados (Pipedrive + S3) */
export type DocumentSource = "PIPEDRIVE" | "S3";

export interface DealDocument {
  id: string;
  source: DocumentSource;
  name: string;
  mime_type?: string | null;
  size?: number | null;
  url?: string | null;          // si S3 → firmada al pedirla; si Pipedrive → directa si se guardó
  drive_file_name?: string | null;
  drive_web_view_link?: string | null;
  created_at?: string | null;   // ISO
}

/* ======================
 * Resúmenes y Detalles
 * ====================== */

/** Fila para listados (tabla de presupuestos) */
export interface DealSummary {
  // La API devuelve deal_id; dejamos dealId opcional para compatibilidad de vistas antiguas
  deal_id: string;
  dealId?: string;

  title: string;

  pipeline_label?: string | null;     // label (no ID)
  training_address?: string | null;   // <-- schema vigente

  sede_label?: string | null;
  caes_label?: string | null;
  fundae_label?: string | null;
  hotel_label?: string | null;
  tipo_servicio?: string | null;
  mail_invoice?: string | null;

  hours?: number | null;    // editable en ERP (no autocalculado)
  alumnos?: number | null;  // editable en ERP

  organization?: DealOrganization | null;
  person?: DealPerson | null;

  // Para pintar chips o resúmenes
  products?: DealProduct[];
  productNames?: string[];
}

/** Detalle completo (para el modal) */
export interface DealDetail {
  deal_id: string;
  title?: string | null;

  pipeline_label?: string | null;     // label (no ID)
  training_address?: string | null;   // <-- schema vigente

  sede_label?: string | null;
  caes_label?: string | null;
  fundae_label?: string | null;
  hotel_label?: string | null;
  transporte?: "Si" | "Sí" | "No" | null;
  po?: string | null;
  tipo_servicio?: string | null;
  mail_invoice?: string | null;

  hours?: number | null;    // editable en ERP
  alumnos?: number | null;  // editable en ERP

  organization?: DealOrganization | null;
  person?: DealPerson | null;

  // Nombres alineados con el backend nuevo:
  products?: DealProduct[]; // antes: deal_products
  notes?: DealNote[];       // antes: deal_notes
  documents?: DealDocument[];
}

/* ======================
 * ViewModels de la UI
 * ====================== */

export interface DealDetailViewNote {
  id?: string | null;
  content: string;
  author?: string | null;
}

export interface DealDetailViewModel {
  dealId: string;
  title: string | null;

  organizationName: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;

  pipelineLabel: string | null;    // proviene de pipeline_label
  trainingAddress: string | null;  // proviene de training_address

  productName: string | null;      // si la vista necesita destacar uno
  hours: number | null;
  alumnos: number | null;

  sedeLabel: string | null;
  caesLabel: string | null;
  fundaeLabel: string | null;
  hotelLabel: string | null;

  // 'extras' se deja por compatibilidad si la vista lo usaba (no llega ya del backend)
  extras?: unknown;

  products: DealProduct[];
  notes: DealDetailViewNote[];
}
