-- Marca los flags booleanos de deals cuando todas las sesiones asociadas
-- finalizaron antes de hoy.
-- 
-- Reglas:
--   - caes_val       = TRUE si caes_label es 'Si'
--   - fundae_val     = TRUE si fundae_label es 'Si'
--   - hotel_val      = TRUE si hotel_label es 'Si'
--   - transporte_val = TRUE si transporte es 'Si'
--   - po_val         = TRUE siempre
--
-- Solo aplica a presupuestos (deals) cuyas sesiones ya finalizaron
-- (todas las sesiones con fecha_fin_utc anteriores a la fecha actual).

UPDATE deals d
SET
  caes_val = d.caes_label = 'Si',
  fundae_val = d.fundae_label = 'Si',
  hotel_val = d.hotel_label = 'Si',
  transporte_val = d.transporte = 'Si',
  po_val = TRUE
WHERE
  -- El trato tiene sesiones registradas
  EXISTS (
    SELECT 1 FROM sesiones s WHERE s.deal_id = d.deal_id
  )
  -- Todas las sesiones han terminado antes de hoy
  AND NOT EXISTS (
    SELECT 1
    FROM sesiones s
    WHERE s.deal_id = d.deal_id
      AND (s.fecha_fin_utc IS NULL OR s.fecha_fin_utc::date >= CURRENT_DATE)
  );
