const { spawnSync } = require('child_process');
const path = require('path');

const MAX_ATTEMPTS = parseInt(process.env.PRISMA_MIGRATE_MAX_ATTEMPTS || '5', 10);
const BACKOFF_MS = parseInt(process.env.PRISMA_MIGRATE_BACKOFF_MS || '10000', 10);
const STATEMENT_TIMEOUT = parseInt(process.env.PRISMA_STATEMENT_TIMEOUT || '60000', 10);

const resolvedMigrateLockTimeout =
  process.env.PRISMA_MIGRATE_ENGINE_ADVISORY_LOCK_TIMEOUT || '120000';
const resolvedSchemaLockTimeout =
  process.env.PRISMA_SCHEMA_ENGINE_ADVISORY_LOCK_TIMEOUT || '120000';

// Avoid Neon cancelling the advisory lock attempt after 10s (default statement_timeout).
// We cannot change the remote DB default, so we append a query param to the connection
// string only for this script to give migrations a wider margin.
let databaseUrl = process.env.DATABASE_URL;

if (databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.set('statement_timeout', `${STATEMENT_TIMEOUT}`);
    databaseUrl = parsed.toString();
  } catch (error) {
    console.warn('Could not parse DATABASE_URL to inject statement_timeout; using raw value', error);
  }
}

const env = {
  ...process.env,
  ...(databaseUrl ? { DATABASE_URL: databaseUrl } : null),
  PRISMA_MIGRATE_ENGINE_ADVISORY_LOCK_TIMEOUT: resolvedMigrateLockTimeout,
  PRISMA_SCHEMA_ENGINE_ADVISORY_LOCK_TIMEOUT: resolvedSchemaLockTimeout,
};

console.log('Prisma advisory lock timeouts (ms):', {
  migrate: resolvedMigrateLockTimeout,
  schema: resolvedSchemaLockTimeout,
});

const backendDir = path.join(__dirname, '..', 'backend');
const failedMigration = '20251120000002_add_atributos_to_products';

console.log(`Attempting to resolve failed migration "${failedMigration}" (if present)...`);
const resolveResult = spawnSync(
  'npx',
  [
    'prisma',
    'migrate',
    'resolve',
    '--applied',
    failedMigration,
    '--schema',
    'prisma/schema.prisma',
  ],
  { cwd: backendDir, env, stdio: 'inherit' }
);

if (resolveResult.status === 0) {
  console.log(`Migration "${failedMigration}" marked as applied.`);
} else {
  console.warn(
    `Could not mark migration "${failedMigration}" as applied (it may already be resolved); continuing with deploy.`
  );
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  console.log(`Prisma migrate deploy (attempt ${attempt}/${MAX_ATTEMPTS})...`);
  const result = spawnSync(
    'npx',
    ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    { cwd: backendDir, env, stdio: 'inherit' }
  );

  if (result.status === 0) {
    console.log('Prisma migrate deploy succeeded');
    process.exit(0);
  }

  const isLastAttempt = attempt === MAX_ATTEMPTS;
  if (isLastAttempt) {
    console.error('Prisma migrate deploy failed after maximum retries');
    process.exit(result.status || 1);
  }

  console.warn(`Prisma migrate deploy failed (attempt ${attempt}); retrying in ${BACKOFF_MS}ms...`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BACKOFF_MS);
}
