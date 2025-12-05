// frontend/src/types/product.ts
export type ProductAttribute = {
  nombre: string;
  valor: string;
  cantidad: number;
};

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
  price: number | null;
  atributos: ProductAttribute[];
  almacen_stock: number | null;
  provider_ids: number[];
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
};
