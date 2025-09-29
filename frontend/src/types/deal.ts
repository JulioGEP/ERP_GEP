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
  dealId: number;
  dealOrgId: number;
  organizationName: string;
  organizationCif?: string | null;
  organizationPhone?: string | null;
  organizationAddress?: string | null;
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
  documentsUrls?: (string | null)[];
  notesCount?: number;
  notes?: string[];
  participants?: DealParticipant[];
  createdAt?: string;
  updatedAt?: string;
}
