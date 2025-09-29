export interface DealSummary {
  dealId: number;
  title: string;
  clientName: string;
  sede: string;
  trainingNames?: string[];
  trainingType?: string | null;
  hours?: number | null;
  caes?: string | null;
  fundae?: string | null;
  hotelNight?: string | null;
  notes?: string[];
  documents?: string[];
}
