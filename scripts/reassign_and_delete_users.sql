-- Reasigna formaciones entre formadores y elimina usuarios concretos.
-- Ejecutar con: psql "$DATABASE_URL" -f scripts/reassign_and_delete_users.sql

BEGIN;

-- Parejas origen -> destino
WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    m.source_email,
    m.target_email,
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id,
    us.id         AS source_user_id,
    ut.id         AS target_user_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
)
-- Eliminar filas que provocarían conflicto por PK/UNIQUE al mover trainer_id.
WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
  WHERE ts.trainer_id IS NOT NULL
    AND tt.trainer_id IS NOT NULL
)
DELETE FROM sesion_trainers st
USING trainer_map tm
WHERE st.trainer_id = tm.source_trainer_id
  AND EXISTS (
    SELECT 1
    FROM sesion_trainers dup
    WHERE dup.sesion_id = st.sesion_id
      AND dup.trainer_id = tm.target_trainer_id
  );

WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
  WHERE ts.trainer_id IS NOT NULL
    AND tt.trainer_id IS NOT NULL
)
DELETE FROM trainer_session_time_logs l
USING trainer_map tm
WHERE l.trainer_id = tm.source_trainer_id
  AND (
    (l.session_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM trainer_session_time_logs dup
      WHERE dup.trainer_id = tm.target_trainer_id
        AND dup.session_id = l.session_id
    ))
    OR
    (l.variant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM trainer_session_time_logs dup
      WHERE dup.trainer_id = tm.target_trainer_id
        AND dup.variant_id = l.variant_id
    ))
  );

WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
  WHERE ts.trainer_id IS NOT NULL
    AND tt.trainer_id IS NOT NULL
)
DELETE FROM trainer_extra_costs c
USING trainer_map tm
WHERE c.trainer_id = tm.source_trainer_id
  AND (
    (c.session_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM trainer_extra_costs dup
      WHERE dup.trainer_id = tm.target_trainer_id
        AND dup.session_id = c.session_id
    ))
    OR
    (c.variant_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM trainer_extra_costs dup
      WHERE dup.trainer_id = tm.target_trainer_id
        AND dup.variant_id = c.variant_id
    ))
  );

WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
  WHERE ts.trainer_id IS NOT NULL
    AND tt.trainer_id IS NOT NULL
)
DELETE FROM variant_trainer_invites vti
USING trainer_map tm
WHERE vti.trainer_id = tm.source_trainer_id
  AND EXISTS (
    SELECT 1
    FROM variant_trainer_invites dup
    WHERE dup.variant_id = vti.variant_id
      AND dup.trainer_id = tm.target_trainer_id
  );

-- Reasignación principal de "formaciones" y tablas relacionadas.
WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id,
    us.id         AS source_user_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
)
UPDATE variants v
SET trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM trainer_map tm
WHERE v.trainer_id = tm.source_trainer_id
  AND tm.target_trainer_id IS NOT NULL;

WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
  WHERE ts.trainer_id IS NOT NULL
    AND tt.trainer_id IS NOT NULL
)
UPDATE sesion_trainers st
SET trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM trainer_map tm
WHERE st.trainer_id = tm.source_trainer_id;

WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
  WHERE ts.trainer_id IS NOT NULL
    AND tt.trainer_id IS NOT NULL
)
UPDATE trainer_session_time_logs l
SET trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM trainer_map tm
WHERE l.trainer_id = tm.source_trainer_id;

WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
  WHERE ts.trainer_id IS NOT NULL
    AND tt.trainer_id IS NOT NULL
)
UPDATE trainer_extra_costs c
SET trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM trainer_map tm
WHERE c.trainer_id = tm.source_trainer_id;

WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
  WHERE ts.trainer_id IS NOT NULL
    AND tt.trainer_id IS NOT NULL
)
UPDATE variant_trainer_invites vti
SET trainer_id = tm.target_trainer_id,
    updated_at = now(),
    trainer_email = (SELECT email FROM trainers t WHERE t.trainer_id = tm.target_trainer_id)
FROM trainer_map tm
WHERE vti.trainer_id = tm.source_trainer_id;

WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email, 'manuela@gepgroup.es'::text AS target_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text, 'jaime@gepgroup.es'
),
trainer_map AS (
  SELECT
    ts.trainer_id AS source_trainer_id,
    tt.trainer_id AS target_trainer_id
  FROM mappings m
  JOIN users us ON lower(us.email) = lower(m.source_email)
  JOIN users ut ON lower(ut.email) = lower(m.target_email)
  LEFT JOIN trainers ts ON ts.user_id = us.id
  LEFT JOIN trainers tt ON tt.user_id = ut.id
  WHERE ts.trainer_id IS NOT NULL
    AND tt.trainer_id IS NOT NULL
)
UPDATE sesion_files sf
SET trainer_expense_trainer_id = tm.target_trainer_id,
    updated_at = now()
FROM trainer_map tm
WHERE sf.trainer_expense_trainer_id = tm.source_trainer_id;

-- Desvincula/archiva formadores origen y elimina usuarios origen.
WITH mappings AS (
  SELECT 'nolien74@gmail.com'::text AS source_email
  UNION ALL
  SELECT 'jmartretmartinez@gmail.com'::text
),
source_users AS (
  SELECT id FROM users u JOIN mappings m ON lower(u.email) = lower(m.source_email)
)
UPDATE trainers t
SET user_id = NULL,
    activo = false,
    updated_at = now()
FROM source_users su
WHERE t.user_id = su.id;

DELETE FROM users
WHERE lower(email) IN (
  lower('nolien74@gmail.com'),
  lower('jmartretmartinez@gmail.com')
);

COMMIT;
