import { readdir, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const KEEP_PATTERNS = [
  /libquery_engine-rhel-openssl-3\.0\.x\.so\.node$/,
  /libquery_engine-debian-openssl-3\.0\.x\.so\.node$/,
];

function shouldKeep(entry) {
  return KEEP_PATTERNS.some((pattern) => pattern.test(entry));
}
const isNetlify = process.env.NETLIFY === 'true' || process.env.CI === 'true';

if (!isNetlify) {
  // Only prune during CI/Netlify builds so local development keeps the native engine.
  process.exit(0);
}

async function pruneDirectory(root) {
  try {
    const dirStat = await stat(root);
    if (!dirStat.isDirectory()) return [];
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const entries = await readdir(root);
  const removed = [];

  await Promise.all(
    entries
      .filter((entry) => entry.startsWith('libquery_engine-') && !shouldKeep(entry))
      .map(async (entry) => {
        const filePath = resolve(root, entry);
        await rm(filePath, { force: true });
        removed.push(`${entry} @ ${root}`);
      }),
  );

  return removed;
}

async function main() {
  const roots = [
    resolve(process.cwd(), 'node_modules/.prisma/client'),
    resolve(process.cwd(), 'backend/functions/node_modules/.prisma/client'),
  ];

  const removed = (
    await Promise.all(roots.map((root) => pruneDirectory(root)))
  ).flat();

  if (removed.length) {
    console.warn(
      `Prisma binary pruning removed ${removed.length} item(s): ${removed.join(', ')}`,
    );
  }
}

main().catch((error) => {
  console.error('Failed to prune Prisma binaries:', error);
  process.exitCode = 1;
});
