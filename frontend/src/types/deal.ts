export interface TrainingProduct {
  product_id: number | null;
  name: string | null;
  code: string | null;
  quantity: number;
}

export interface DealParticipant {
  personId: number | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
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
  dealOrgId: number | null;
  organizationName: string;
  organizationCif?: string | null;
  organizationPhone?: string | null;
  organizationAddress?: string | null;
  title: string;
  clientName: string;
  sede_label?: string | null;
  trainingNames?: string[];
  training?: TrainingProduct[];
  trainingType?: string | null;
  hours?: number | null;
  training_address?: string | null;
  caes_label?: string | null;
  fundae_label?: string | null;
  hotel_label?: string | null;
  alumnos?: number | null;
  prodExtra?: TrainingProduct[];
  prodExtraNames?: string[];
  documentsNum?: number;
  documentsId?: number[];
  documents?: string[];
  documentsUrls?: (string | null)[];
  notesCount?: number;
  notes?: string[];
}
