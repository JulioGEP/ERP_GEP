import { describe, expect, it } from 'vitest';

import type { SessionStudent } from '../../../api/sessions.types';
import type { DealDetail } from '../../../types/deal';
import {
  isOpenTrainingDeal,
  mapStudentsToCertificateRows,
  type CertificateSession,
} from './mappers';

const createDeal = (overrides: Partial<DealDetail> = {}): DealDetail => ({
  deal_id: 'deal-1',
  title: null,
  pipeline_label: 'Formación abierta',
  pipeline_id: 'formacion abierta',
  training_address: null,
  sede_label: 'Valencia',
  caes_label: null,
  fundae_label: null,
  hotel_label: null,
  comercial: null,
  a_fecha: '2025-10-16T00:00:00Z',
  w_id_variation: null,
  modo_reserva: null,
  hours: null,
  organization: { org_id: null, name: 'Cliente' },
  person: null,
  products: [],
  notes: [],
  documents: [],
  ...overrides,
});

describe('isOpenTrainingDeal', () => {
  it('detects open training deals when pipeline label contains the keyword', () => {
    const deal = createDeal({ pipeline_label: 'A- Formación abierta 2025' });
    expect(isOpenTrainingDeal(deal)).toBe(true);
  });

  it('returns false for non open-training deals', () => {
    const deal = createDeal({ pipeline_label: 'Formación empresa', pipeline_id: 'formacion empresa' });
    expect(isOpenTrainingDeal(deal)).toBe(false);
  });
});

describe('mapStudentsToCertificateRows', () => {
  const baseSession: CertificateSession = {
    id: 'session-1',
    deal_id: 'deal-1',
    deal_product_id: 'product-1',
    nombre_cache: 'Sesión',
    fecha_inicio_utc: '2025-12-01',
    fecha_fin_utc: null,
    sala_id: null,
    direccion: '',
    estado: 'PLANIFICADA',
    drive_url: null,
    trainer_ids: [],
    unidad_movil_ids: [],
    productId: 'product-1',
    productName: 'Curso genérico',
    productHours: 8,
    productTemplate: null,
  };

  const student: SessionStudent = {
    id: 'student-1',
    deal_id: 'deal-1',
    sesion_id: 'session-1',
    nombre: 'Ana',
    apellido: 'García',
    dni: '12345678A',
    apto: true,
    certificado: false,
    drive_url: null,
    created_at: null,
    updated_at: null,
  };

  it('uses deal.a_fecha to populate the row date for open training deals', () => {
    const deal = createDeal({ a_fecha: '2025-10-16T00:00:00Z' });

    const rows = mapStudentsToCertificateRows({
      students: [student],
      deal,
      session: baseSession,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].fecha).toBe('16/10/2025');
  });
});
