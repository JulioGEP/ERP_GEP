CREATE TABLE IF NOT EXISTS actuaciones_preventivos_informes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id TEXT NOT NULL,
  cliente TEXT,
  persona_contacto TEXT,
  direccion_preventivo TEXT,
  bombero TEXT NOT NULL,
  fecha_ejercicio TIMESTAMPTZ NOT NULL,
  turno TEXT NOT NULL DEFAULT 'Mañana',
  partes_trabajo INTEGER,
  asistencias_sanitarias INTEGER,
  observaciones TEXT,
  responsable TEXT,
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT actuaciones_preventivos_informes_partes_trabajo_check
    CHECK (partes_trabajo IS NULL OR partes_trabajo >= 0),
  CONSTRAINT actuaciones_preventivos_informes_asistencias_sanitarias_check
    CHECK (asistencias_sanitarias IS NULL OR asistencias_sanitarias >= 0),
  CONSTRAINT actuaciones_preventivos_informes_turno_check
    CHECK (turno IN ('Mañana', 'Noche'))
);

CREATE INDEX IF NOT EXISTS idx_actuaciones_preventivos_informes_deal_id
  ON actuaciones_preventivos_informes (deal_id);

CREATE INDEX IF NOT EXISTS idx_actuaciones_preventivos_informes_fecha_ejercicio
  ON actuaciones_preventivos_informes (fecha_ejercicio DESC);

CREATE INDEX IF NOT EXISTS idx_actuaciones_preventivos_informes_created_by_user_id
  ON actuaciones_preventivos_informes (created_by_user_id);
