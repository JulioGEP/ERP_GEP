-- Duplicate variant 16924 (Formación inicial de Bombero de empresa 350 horas) for new dates
-- Base row: WooCommerce variation 16924 scheduled on 2025-05-20 in Sabadell
-- This script clones the row for each date listed below using new id_woo values
-- derived from the current maximum id_woo in the variants table.
--
-- Run inside the NEON database after ensuring a backup is available.

WITH base_variant AS (
  SELECT
    id_woo,
    name,
    status,
    finalizar,
    price,
    stock,
    stock_status,
    sede,
    date,
    id_padre,
    trainer_id,
    sala_id,
    unidad_movil_id
  FROM variants
  WHERE id_woo = 16924
    AND date::date = DATE '2025-05-20'
  LIMIT 1
),
new_dates AS (
  SELECT d::date AS session_date
  FROM (VALUES
    (DATE '2025-05-27'),
    (DATE '2025-06-03'),
    (DATE '2025-06-10'),
    (DATE '2025-06-17'),
    (DATE '2025-07-01'),
    (DATE '2025-07-08'),
    (DATE '2025-07-15'),
    (DATE '2025-07-22'),
    (DATE '2025-09-09'),
    (DATE '2025-09-16'),
    (DATE '2025-09-25'),
    (DATE '2025-09-30'),
    (DATE '2025-10-07'),
    (DATE '2025-10-14'),
    (DATE '2025-10-21'),
    (DATE '2025-10-28'),
    (DATE '2025-11-04'),
    (DATE '2025-11-11'),
    (DATE '2025-11-18'),
    (DATE '2025-11-25'),
    (DATE '2025-12-02'),
    (DATE '2025-12-09'),
    (DATE '2025-12-16'),
    (DATE '2026-01-13'),
    (DATE '2026-01-20'),
    (DATE '2026-01-27'),
    (DATE '2026-02-03'),
    (DATE '2026-02-10'),
    (DATE '2026-02-17'),
    (DATE '2026-02-24'),
    (DATE '2026-03-03'),
    (DATE '2026-03-10')
  ) AS dates(d)
),
numbered_dates AS (
  SELECT
    session_date,
    ROW_NUMBER() OVER (ORDER BY session_date) AS rn
  FROM new_dates
),
max_base AS (
  SELECT COALESCE(GREATEST(MAX(id_woo), 16924), 16924) AS base_id_woo FROM variants
),
inserted AS (
  INSERT INTO variants (
    id_woo,
    name,
    status,
    finalizar,
    price,
    stock,
    stock_status,
    sede,
    date,
    id_padre,
    trainer_id,
    sala_id,
    unidad_movil_id
  )
  SELECT
    max_base.base_id_woo + numbered_dates.rn,
    base_variant.name,
    base_variant.status,
    base_variant.finalizar,
    base_variant.price,
    base_variant.stock,
    base_variant.stock_status,
    base_variant.sede,
    numbered_dates.session_date::timestamp,
    base_variant.id_padre,
    base_variant.trainer_id,
    base_variant.sala_id,
    base_variant.unidad_movil_id
  FROM base_variant
  CROSS JOIN numbered_dates
  CROSS JOIN max_base
  RETURNING id_woo, date::date AS session_date
)
SELECT * FROM inserted ORDER BY session_date;
