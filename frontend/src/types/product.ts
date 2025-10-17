// frontend/src/types/product.ts
export type Product = {
  id: string;
  id_pipe: string;
  name: string | null;
  code: string | null;
  category: string | null;
  type: string | null;
  template: string | null;
  url_formacion: string | null;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
};
