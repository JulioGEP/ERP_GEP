import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatorio'),
  PIPEDRIVE_BASE_URL: z.string().url(),
  PIPEDRIVE_API_TOKEN: z.string().min(1, 'PIPEDRIVE_API_TOKEN es obligatorio')
});

type EnvSchema = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Configuración de entorno inválida', parsed.error.flatten().fieldErrors);
  throw new Error('Variables de entorno inválidas');
}

export const env: EnvSchema = parsed.data;
