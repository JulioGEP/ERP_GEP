export type VariantInfo = {
  id: string;
  id_woo: string;
  name: string | null;
  status: string | null;
  price: string | null;
  stock: number | null;
  stock_status: string | null;
  sede: string | null;
  date: string | null;
  trainer_id: string | null;
  trainer_ids: string[];
  trainer: { trainer_id: string; name: string | null; apellido: string | null } | null;
  trainers: Array<{ trainer_id: string; name: string | null; apellido: string | null }>;
  trainer_confirmations: Array<{ trainer_id: string; mail_sent_at: string | null }>;
  sala_id: string | null;
  sala: { sala_id: string; name: string; sede: string | null } | null;
  unidad_movil_id: string | null;
  unidad_movil_ids: string[];
  unidad: { unidad_id: string; name: string; matricula: string | null } | null;
  unidades: Array<{ unidad_id: string; name: string; matricula: string | null }>;
  created_at: string | null;
  updated_at: string | null;
};

export type ProductDefaults = {
  default_variant_start: string | null;
  default_variant_end: string | null;
  default_variant_stock_status: string | null;
  default_variant_stock_quantity: number | null;
  default_variant_price: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
};

export type ProductInfo = ProductDefaults & {
  id: string;
  id_woo: string | null;
  name: string | null;
  code: string | null;
  category: string | null;
  variants: VariantInfo[];
};

export type ActiveVariant = {
  product: ProductInfo;
  variant: VariantInfo;
};

export type ProductDefaultsUpdatePayload = {
  stock_status?: string | null;
  stock_quantity?: number | null;
  price?: string | null;
  hora_inicio?: string | null;
  hora_fin?: string | null;
};

export type VariantUpdatePayload = {
  price?: string | null;
  stock?: number | null;
  stock_status?: string | null;
  status?: string | null;
  sede?: string | null;
  date?: string | null;
  trainer_ids?: string[];
  sala_id?: string | null;
  unidad_movil_ids?: string[];
};

export type DealProductInfo = {
  id: string;
  name: string | null;
  code: string | null;
  price: string | null;
};

export type DealTag = {
  deal_id: string;
  title: string;
  products: DealProductInfo[];
  w_id_variation: string | null;
  a_fecha: string | null;
  students_count: number;
  organization: { name: string | null } | null;
  person: { first_name: string | null; last_name: string | null } | null;
  fundae_label: string | null;
  po: string | null;
};

export type VariantSortKey = {
  location: string | null;
  year: number | null;
  month: number | null;
  day: number | null;
};

export type VariantMonthGroup = {
  key: string;
  label: string;
  sortYear: number | null;
  sortMonth: number | null;
  variants: VariantInfo[];
};

export type VariantLocationGroup = {
  key: string;
  label: string;
  variantsByMonth: VariantMonthGroup[];
  totalVariants: number;
};
