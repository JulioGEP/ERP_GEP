export interface DealSummary {
  dealId: number;
  title: string;
  clientName: string;
  sede_label?: string | null;
  trainingNames?: string[];
  trainingType?: string | null;
  hours?: number | null;
  caes_label?: string | null;
  fundae_label?: string | null;
  hotel_label?: string | null;
  notes?: string[];
  documents?: string[];
}
