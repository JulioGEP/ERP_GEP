-- Ensure pedidos.recipient_email exists for material order persistence
ALTER TABLE "pedidos"
ADD COLUMN IF NOT EXISTS "recipient_email" TEXT;
