-- Añade los campos solicitados para el modal de pedido de material.
-- Ejecutar manualmente sobre la tabla "pedidos".

ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS texto_pedido TEXT,
  ADD COLUMN IF NOT EXISTS pedido_realizado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pedido_recibido BOOLEAN NOT NULL DEFAULT FALSE;

-- Opcional: evita incoherencias (no puede estar recibido si no está realizado).
ALTER TABLE pedidos
  DROP CONSTRAINT IF EXISTS pedidos_recibido_requires_realizado,
  ADD CONSTRAINT pedidos_recibido_requires_realizado
    CHECK (pedido_recibido = FALSE OR pedido_realizado = TRUE);
