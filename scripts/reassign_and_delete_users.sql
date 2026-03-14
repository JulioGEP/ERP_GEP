-- Reasigna formaciones entre formadores y elimina usuarios concretos.
-- Ejecutar con: psql "$DATABASE_URL" -f scripts/reassign_and_delete_users.sql

BEGIN;

CREATE TEMP TABLE _trainer_reassign_map (
  source_email      text PRIMARY KEY,
  target_email      text NOT NULL,
  source_user_id    uuid,
  target_user_id    uuid,
  source_trainer_id text,
  target_trainer_id text
) ON COMMIT DROP;

INSERT INTO _trainer_reassign_map (
  source_email,
  target_email,
  source_user_id,
  target_user_id,
  source_trainer_id,
  target_trainer_id
)
WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
resolved AS (
  SELECT
    m.source_email,
    m.target_email,
    us.id AS source_user_id,
    ut.id AS target_user_id,
    COALESCE(
      (SELECT t.trainer_id FROM trainers t WHERE t.user_id = us.id LIMIT 1),
      (SELECT t.trainer_id FROM trainers t WHERE lower(t.email) = lower(m.source_email) LIMIT 1)
    ) AS source_trainer_id,
    COALESCE(
      (SELECT t.trainer_id FROM trainers t WHERE t.user_id = ut.id LIMIT 1),
      (SELECT t.trainer_id FROM trainers t WHERE lower(t.email) = lower(m.target_email) LIMIT 1)
    ) AS target_trainer_id
  FROM mappings m
  LEFT JOIN users us ON lower(us.email) = lower(m.source_email)
  LEFT JOIN users ut ON lower(ut.email) = lower(m.target_email)
)
SELECT
  source_email,
  target_email,
  source_user_id,
  target_user_id,
  source_trainer_id,
  target_trainer_id
FROM resolved;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM _trainer_reassign_map LOOP
    IF r.source_user_id IS NULL THEN
      RAISE EXCEPTION 'No existe el usuario origen: %', r.source_email;
    END IF;

    IF r.target_user_id IS NULL THEN
      RAISE EXCEPTION 'No existe el usuario destino: %', r.target_email;
    END IF;

    IF r.source_trainer_id IS NULL THEN
      RAISE EXCEPTION 'No se encontró trainer origen para % (ni por user_id ni por email).', r.source_email;
    END IF;

    IF r.target_trainer_id IS NULL THEN
      RAISE EXCEPTION 'No se encontró trainer destino para % (ni por user_id ni por email).', r.target_email;
    END IF;
  END LOOP;
END $$;

-- Eliminar filas que provocarían conflicto por PK/UNIQUE al mover trainer_id.
DELETE FROM sesion_trainers st
USING _trainer_reassign_map tm
WHERE st.trainer_id = tm.source_trainer_id
  AND EXISTS (
    SELECT 1
    FROM sesion_trainers dup
    WHERE dup.sesion_id = st.sesion_id
      AND dup.trainer_id = tm.target_trainer_id
  );

DELETE FROM trainer_session_time_logs l
USING _trainer_reassign_map tm
WHERE l.trainer_id = tm.source_trainer_id
  AND (
    (l.session_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM trainer_session_time_logs dup
      WHERE dup.trainer_id = tm.target_trainer_id
        AND dup.session_id = l.session_id
    ))
    OR
    (l.variant_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM trainer_session_time_logs dup
      WHERE dup.trainer_id = tm.target_trainer_id
        AND dup.variant_id = l.variant_id
    ))
  );

DELETE FROM trainer_extra_costs c
USING _trainer_reassign_map tm
WHERE c.trainer_id = tm.source_trainer_id
  AND (
    (c.session_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM trainer_extra_costs dup
      WHERE dup.trainer_id = tm.target_trainer_id
        AND dup.session_id = c.session_id
    ))
    OR
    (c.variant_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM trainer_extra_costs dup
      WHERE dup.trainer_id = tm.target_trainer_id
        AND dup.variant_id = c.variant_id
    ))
  );

DELETE FROM variant_trainer_invites vti
USING _trainer_reassign_map tm
WHERE vti.trainer_id = tm.source_trainer_id
  AND EXISTS (
    SELECT 1
    FROM variant_trainer_invites dup
    WHERE dup.variant_id = vti.variant_id
      AND dup.trainer_id = tm.target_trainer_id
  );

-- Reasignación principal de formaciones y tablas relacionadas.
UPDATE variants v
SET trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM _trainer_reassign_map tm
WHERE v.trainer_id = tm.source_trainer_id;

UPDATE sesion_trainers st
SET trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM _trainer_reassign_map tm
WHERE st.trainer_id = tm.source_trainer_id;

UPDATE trainer_session_time_logs l
SET trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM _trainer_reassign_map tm
WHERE l.trainer_id = tm.source_trainer_id;

UPDATE trainer_extra_costs c
SET trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM _trainer_reassign_map tm
WHERE c.trainer_id = tm.source_trainer_id;

UPDATE variant_trainer_invites vti
SET trainer_id = tm.target_trainer_id,
    updated_at = now(),
    trainer_email = t.email
FROM _trainer_reassign_map tm
JOIN trainers t ON t.trainer_id = tm.target_trainer_id
WHERE vti.trainer_id = tm.source_trainer_id;

UPDATE sesion_files sf
SET trainer_expense_trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM _trainer_reassign_map tm
WHERE sf.trainer_expense_trainer_id = tm.source_trainer_id;

-- Desvincula y desactiva trainers origen.
UPDATE trainers t
SET user_id = NULL,
    activo = false,
    updated_at = now()
FROM _trainer_reassign_map tm
WHERE t.trainer_id = tm.source_trainer_id;

-- Elimina usuarios origen.
DELETE FROM users u
USING _trainer_reassign_map tm
WHERE lower(u.email) = lower(tm.source_email);

COMMIT;
