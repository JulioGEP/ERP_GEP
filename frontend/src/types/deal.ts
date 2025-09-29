export interface TrainingProduct {
  product_id: number | null;
  name: string | null;
  code: string | null;
  quantity: number;
}

export interface DealSummary {
  dealId: number;
  dealOrgId: number;
  organizationName: string;
  title: string;
  clientName: string;
  sede: string;
  trainingNames?: string[];
  training?: TrainingProduct[];
  trainingType?: string | null;
  hours?: number | null;
  dealDirection?: string | null;
  caes?: string | null;
  fundae?: string | null;
  hotelNight?: string | null;
  prodExtra?: TrainingProduct[];
  prodExtraNames?: string[];
  documentsNum?: number;
  documentsId?: number[];
  documents?: string[];
  notesCount?: number;
  notes?: string[];
  createdAt?: string;
  updatedAt?: string;
}
