import 'dotenv/config';

const required = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
};

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: required('DATABASE_URL'),
  PIPEDRIVE_BASE_URL: process.env.PIPEDRIVE_BASE_URL ?? 'https://api.pipedrive.com/v1',
  PIPEDRIVE_API_TOKEN: required('PIPEDRIVE_API_TOKEN')
};
