CREATE TABLE IF NOT EXISTS public.woocommerce_compras_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  source varchar(100),
  event_name varchar(120),
  order_id varchar(80),
  order_number varchar(80),
  presupuesto varchar(80),
  order_status varchar(40),
  order_total varchar(40),
  currency varchar(10),
  customer_name varchar(255),
  customer_email varchar(320),
  payment_method varchar(150),
  payload_json jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_woocommerce_compras_webhooks_created_at
  ON public.woocommerce_compras_webhooks (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_woocommerce_compras_webhooks_order_id
  ON public.woocommerce_compras_webhooks (order_id);

CREATE INDEX IF NOT EXISTS idx_woocommerce_compras_webhooks_order_status
  ON public.woocommerce_compras_webhooks (order_status);
