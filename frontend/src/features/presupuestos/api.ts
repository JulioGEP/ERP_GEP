import axios from 'axios';
import type { DealSummary } from '../../types/deal';

export interface ImportDealPayload {
  federalNumber: string;
}

export async function importDeal(payload: ImportDealPayload): Promise<DealSummary> {
  const { data } = await axios.post<DealSummary>('/api/deals/import', payload);
  return data;
}
