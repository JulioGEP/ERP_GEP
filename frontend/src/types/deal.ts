export interface DealProduct {
  id?: string | null;
  deal_id?: string | null;
  product_id?: string | null;
  name?: string | null;
  code?: string | null;
  quantity?: number | null;
}

export interface DealNote {
  id?: string | null;
  deal_id?: string | null;
  content?: string | null;
  author?: string | null;
  created_at?: string | null;
}

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

export interface DealDocument {
  id?: string;
  doc_id?: string;
  fileName?: string | null;
  file_name?: string | null;
  fileSize?: number | null;
  file_size?: number | null;
  mimeType?: string | null;
  mime_type?: string | null;
  storageKey?: string | null;
  storage_key?: string | null;
  origin?: string | null;
}

export interface DealComment {
  id?: string;
  comment_id?: string;
  authorId?: string | null;
  author_id?: string | null;
  authorName?: string | null;
  content?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
}

export interface DealSummary {
  /**
   * Identificador externo del presupuesto. Se mantiene como string para preservar formatos no numéricos.
   */
  dealId: string;
  /**
   * Identificador numérico (si existe) del presupuesto. Útil para compatibilidad con APIs antiguas.
   */
  dealNumericId?: number | null;
  title: string;
  sede_label?: string | null;
  pipeline_id?: string | null;
  training_address?: string | null;
  hours?: number | null;
  alumnos?: number | null;
  caes_label?: string | null;
  fundae_label?: string | null;
  hotel_label?: string | null;
  prodextra?: unknown;
  organization?: DealOrganization | null;
  person?: DealPerson | null;
  products?: DealProduct[];
  productNames?: string[];
}

export interface DealDetail {
  deal_id: string;
  title?: string | null;
  pipeline_id?: string | null;
  training_address?: string | null;
  sede_label?: string | null;
  caes_label?: string | null;
  fundae_label?: string | null;
  hotel_label?: string | null;
  hours?: number | null;
  alumnos?: number | null;
  prodextra?: unknown;
  organization?: DealOrganization | null;
  person?: DealPerson | null;
  deal_products?: DealProduct[];
  deal_notes?: DealNote[];
  documents?: DealDocument[];
  comments?: DealComment[];
}
