// frontend/src/types/room.ts
import type { ResourceAvailability } from './resource-conflict';

export type Room = {
  sala_id: string;
  name: string;
  sede: string | null;
  created_at: string | null;
  updated_at: string | null;
  availability?: ResourceAvailability;
};
