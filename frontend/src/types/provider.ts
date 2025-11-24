// frontend/src/types/provider.ts
export type Provider = {
  provider_id: string;
  nombre_fiscal: string;
  direccion_fiscal: string | null;
  telefono_fiscal: string | null;
  mail_empresa: string | null;
  persona_contacto: string | null;
  telefono_contacto: string | null;
  mail_contacto: string | null;
  created_at: string | null;
  updated_at: string | null;
};
