const { spawnSync } = require('child_process');
const path = require('path');

const MAX_ATTEMPTS = parseInt(process.env.PRISMA_MIGRATE_MAX_ATTEMPTS || '5', 10);
const BACKOFF_MS = parseInt(process.env.PRISMA_MIGRATE_BACKOFF_MS || '10000', 10);
const STATEMENT_TIMEOUT = parseInt(process.env.PRISMA_STATEMENT_TIMEOUT || '60000', 10);
const LOCK_TIMEOUT = parseInt(process.env.PRISMA_LOCK_TIMEOUT || `${STATEMENT_TIMEOUT}`, 10);

const resolvedMigrateLockTimeout =
  process.env.PRISMA_MIGRATE_ENGINE_ADVISORY_LOCK_TIMEOUT || '120000';
const resolvedSchemaLockTimeout =
  process.env.PRISMA_SCHEMA_ENGINE_ADVISORY_LOCK_TIMEOUT || '120000';
const SHOULD_SKIP_ON_P1001 =
  process.env.PRISMA_MIGRATE_SKIP_ON_P1001 === 'true' ||
  (process.env.PRISMA_MIGRATE_SKIP_ON_P1001 == null && process.env.NETLIFY === 'true');

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

const isDatabaseUnavailableError = (output = '') =>
  output.includes('P1001') || output.includes("Can't reach database server");

const runPrisma = (args) => {
  const result = spawnSync('npx', args, {
    cwd: backendDir,
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return {
    ...result,
    combinedOutput: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
};

console.log('Prisma advisory lock timeouts (ms):', {
  migrate: resolvedMigrateLockTimeout,
  schema: resolvedSchemaLockTimeout,
  statement: `${STATEMENT_TIMEOUT}`,
  lock: `${LOCK_TIMEOUT}`,
});

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
  const resolveResult = spawnSync(
    'npx',
    [
      'prisma',
      'migrate',
      'resolve',
      `--${migration.resolution}`,
      migration.name,
      '--schema',
      'prisma/schema.prisma',
    ],
    { cwd: backendDir, env, stdio: 'inherit' }
  );

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
  const result = runPrisma(['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma']);

  if (result.status === 0) {
    console.log('Prisma migrate deploy succeeded');
    process.exit(0);
  }

  if (SHOULD_SKIP_ON_P1001 && isDatabaseUnavailableError(result.combinedOutput)) {
    console.warn(
      'Prisma migrate deploy skipped: database is unreachable (P1001). Continuing build because PRISMA_MIGRATE_SKIP_ON_P1001 is enabled.'
    );
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
