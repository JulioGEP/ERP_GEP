-- 1) Vista previa de duplicados
SELECT dni, COUNT(*) c
FROM trainers
WHERE dni IS NOT NULL
GROUP BY dni HAVING COUNT(*) > 1;

SELECT email, COUNT(*) c
FROM trainers
WHERE email IS NOT NULL
GROUP BY email HAVING COUNT(*) > 1;

-- 2) Resolver duplicados de DNI:
-- Conserva 1 registro por DNI (el más antiguo por created_at si existe)
WITH ranked AS (
  SELECT
    trainer_id,
    dni,
    ROW_NUMBER() OVER (
      PARTITION BY dni
      ORDER BY created_at ASC NULLS LAST, trainer_id ASC
    ) AS rn
  FROM trainers
  WHERE dni IS NOT NULL
)
UPDATE trainers t
SET dni = NULL
FROM ranked r
WHERE t.trainer_id = r.trainer_id
  AND r.rn > 1;

-- 3) Resolver duplicados de EMAIL (mismo criterio)
WITH ranked_e AS (
  SELECT
    trainer_id,
    email,
    ROW_NUMBER() OVER (
      PARTITION BY email
      ORDER BY created_at ASC NULLS LAST, trainer_id ASC
    ) AS rn
  FROM trainers
  WHERE email IS NOT NULL
)
UPDATE trainers t
SET email = NULL
FROM ranked_e r
WHERE t.trainer_id = r.trainer_id
  AND r.rn > 1;
