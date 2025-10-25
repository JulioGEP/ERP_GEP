import type {
  DealDetail,
  DealDetailViewModel,
  DealDocument,
  DealNote,
  DealProduct,
  DealSummary,
  DealSummarySession,
} from '../../types/deal';

export type SessionEstado = 'BORRADOR' | 'PLANIFICADA' | 'SUSPENDIDA' | 'CANCELADA' | 'FINALIZADA';

export const SESSION_ESTADOS: SessionEstado[] = [
  'BORRADOR',
  'PLANIFICADA',
  'SUSPENDIDA',
  'CANCELADA',
  'FINALIZADA',
];

export type SessionDTO = {
  id: string;
  deal_id: string;
  deal_product_id: string;
  nombre_cache: string;
  fecha_inicio_utc: string | null;
  fecha_fin_utc: string | null;
  sala_id: string | null;
  direccion: string;
  estado: SessionEstado;
  drive_url: string | null;
  trainer_ids: string[];
  unidad_movil_ids: string[];
};

export type SessionGroupDTO = {
  product: {
    id: string;
    code: string | null;
    name: string | null;
    quantity: number;
  };
  sessions: SessionDTO[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type SessionComment = {
  id: string;
  deal_id: string;
  sesion_id: string;
  content: string;
  author: string | null;
  compartir_formador: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type CreateSessionCommentInput = {
  content: string;
  compartir_formador?: boolean;
};

export type UpdateSessionCommentInput = {
  content?: string;
  compartir_formador?: boolean;
};

export type SessionDocument = {
  id: string;
  deal_id: string;
  sesion_id: string;
  file_type: string | null;
  compartir_formador: boolean;
  added_at: string | null;
  updated_at: string | null;
  drive_file_name: string | null;
  drive_web_view_link: string | null;
};

export type SessionDocumentsPayload = {
  documents: SessionDocument[];
  driveUrl: string | null;
};

export type SessionStudent = {
  id: string;
  deal_id: string;
  sesion_id: string;
  nombre: string;
  apellido: string;
  dni: string;
  apto: boolean;
  certificado: boolean;
  drive_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type SessionPublicLink = {
  id: string;
  deal_id: string;
  sesion_id: string;
  token: string;
  public_path: string | null;
  public_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_access_at: string | null;
  last_access_ip: string | null;
  last_access_ua: string | null;
  active: boolean;
  ip_created: string | null;
  user_agent: string | null;
};

export type PublicSessionInfo = {
  deal_id: string | null;
  sesion_id: string | null;
  session_name: string | null;
  formation_name: string | null;
  title: string | null;
};

export type SessionCounts = {
  comentarios: number;
  documentos: number;
  alumnos: number;
  tokens: number;
};

export type TrainerOption = {
  trainer_id: string;
  name: string;
  apellido: string | null;
  activo: boolean;
};

export type RoomOption = {
  sala_id: string;
  name: string;
  sede: string | null;
};

export type MobileUnitOption = {
  unidad_id: string;
  name: string;
  matricula: string | null;
};

export type ProductVariantOption = {
  productId: string;
  productPipeId: string | null;
  productWooId: string | null;
  productName: string | null;
  productCode: string | null;
  variantId: string;
  wooId: string | null;
  name: string | null;
  date: string | null;
  status: string | null;
  parentWooId: string | null;
  sede: string | null;
};

export type SessionAvailability = {
  trainers: string[];
  rooms: string[];
  units: string[];
};

export type PublicStudentInput = {
  token: string;
  nombre: string;
  apellido: string;
  dni: string;
};

export type Json = any;

export type {
  DealDetail,
  DealDetailViewModel,
  DealDocument,
  DealNote,
  DealProduct,
  DealSummary,
  DealSummarySession,
};
