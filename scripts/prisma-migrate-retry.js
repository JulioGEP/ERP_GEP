const { spawnSync } = require('child_process');
const path = require('path');

const MAX_ATTEMPTS = parseInt(process.env.PRISMA_MIGRATE_MAX_ATTEMPTS || '5', 10);
const BACKOFF_MS = parseInt(process.env.PRISMA_MIGRATE_BACKOFF_MS || '10000', 10);
const STATEMENT_TIMEOUT = parseInt(process.env.PRISMA_STATEMENT_TIMEOUT || '60000', 10);
const ALLOW_P1001_CONTINUE = String(process.env.PRISMA_MIGRATE_ALLOW_P1001 || '').toLowerCase() === 'true';

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
    parsed.searchParams.set('lock_timeout', `${LOCK_TIMEOUT}`);

    // Neon pooler can enforce a low default statement_timeout; injecting startup options
    // ensures Prisma's advisory lock query is allowed to wait longer than 10s.
    const startupOptions = `-c statement_timeout=${STATEMENT_TIMEOUT} -c lock_timeout=${LOCK_TIMEOUT}`;
    parsed.searchParams.set('options', startupOptions);

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
  statement: `${STATEMENT_TIMEOUT}`,
  lock: `${LOCK_TIMEOUT}`,
});

function isP1001Error(output) {
  if (!output) return false;
  return output.includes('Error: P1001');
}

function runPrismaCommand(args) {
  const result = spawnSync('npx', args, { cwd: backendDir, env, encoding: 'utf8' });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const combinedOutput = `${result.stdout || ''}
${result.stderr || ''}`;
  return { status: result.status ?? 1, combinedOutput };
}

const backendDir = path.join(__dirname, '..', 'backend');
const migrationsToResolve = [
  {
    name: '20251120000002_add_atributos_to_products',
    resolution: 'applied',
  },
  {
    name: '20260602110000_add_nomina_contrato_to_trainers',
    resolution: 'rolled-back',
  },
  {
    name: '20251120000003_add_payroll_detail_fields',
    resolution: 'rolled-back',
  },
];

for (const migration of migrationsToResolve) {
  console.log(`Attempting to resolve migration "${migration.name}" as ${migration.resolution} (if present)...`);
  const resolveResult = runPrismaCommand([
    'prisma',
    'migrate',
    'resolve',
    `--${migration.resolution}`,
    migration.name,
    '--schema',
    'prisma/schema.prisma',
  ]);

  if (resolveResult.status === 0) {
    console.log(`Migration "${migration.name}" marked as ${migration.resolution}.`);
  } else {
    console.warn(
      `Could not mark migration "${migration.name}" as ${migration.resolution} (it may already be resolved); continuing with deploy.`
    );
  }
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  console.log(`Prisma migrate deploy (attempt ${attempt}/${MAX_ATTEMPTS})...`);
  const result = runPrismaCommand([
    'prisma',
    'migrate',
    'deploy',
    '--schema',
    'prisma/schema.prisma',
  ]);

  if (result.status === 0) {
    console.log('Prisma migrate deploy succeeded');
    process.exit(0);
  }

  const isLastAttempt = attempt === MAX_ATTEMPTS;
  if (isLastAttempt) {
    if (ALLOW_P1001_CONTINUE && isP1001Error(result.combinedOutput)) {
      console.warn('Prisma migrate deploy failed with P1001 after maximum retries; continuing because PRISMA_MIGRATE_ALLOW_P1001=true');
      process.exit(0);
    }
    console.error('Prisma migrate deploy failed after maximum retries');
    process.exit(result.status || 1);
  }

  console.warn(`Prisma migrate deploy failed (attempt ${attempt}); retrying in ${BACKOFF_MS}ms...`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BACKOFF_MS);
}
