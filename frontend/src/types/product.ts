// frontend/src/types/product.ts
export type Product = {
  id: string;
  id_pipe: string;
  id_woo: number | null;
  name: string | null;
  code: string | null;
  category: string | null;
  type: string | null;
  template: string | null;
  url_formacion: string | null;
  provider_ids: number[];
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
};
