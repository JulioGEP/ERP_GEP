-- Tabla para informes de /informes/actuaciones_preventivos
CREATE TABLE IF NOT EXISTS actuaciones_preventivos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presupuesto TEXT NOT NULL,
  cliente TEXT NOT NULL,
  persona_contacto TEXT NOT NULL,
  direccion_preventivo TEXT NOT NULL,
  bombero TEXT NOT NULL,
  fecha_ejercicio TIMESTAMPTZ NOT NULL,
  turno TEXT NOT NULL,
  partes_trabajo INTEGER NOT NULL DEFAULT 0 CHECK (partes_trabajo >= 0),
  asistencias_sanitarias INTEGER NOT NULL DEFAULT 0 CHECK (asistencias_sanitarias >= 0),
  observaciones TEXT NOT NULL DEFAULT '',
  responsable TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_actuaciones_preventivos_presupuesto
  ON actuaciones_preventivos (presupuesto);

CREATE INDEX IF NOT EXISTS idx_actuaciones_preventivos_fecha
  ON actuaciones_preventivos (fecha_ejercicio DESC);

CREATE OR REPLACE FUNCTION set_timestamp_actuaciones_preventivos()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_timestamp_actuaciones_preventivos ON actuaciones_preventivos;

CREATE TRIGGER trg_set_timestamp_actuaciones_preventivos
BEFORE UPDATE ON actuaciones_preventivos
FOR EACH ROW
EXECUTE FUNCTION set_timestamp_actuaciones_preventivos();
