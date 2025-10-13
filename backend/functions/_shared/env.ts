// backend/functions/_shared/env.ts
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || String(v).trim() === '') {
    const err: any = new Error(`ENV_MISSING:${name}`);
    err.code = 'ENV_MISSING';
    err.varName = name;
    throw err;
  }
  return String(v);
}
