import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const vitestBin = path.resolve(cwd, '..', 'node_modules', '.bin', 'vitest');

const mappedArgs = process.argv.slice(2).flatMap((arg) => {
  if (arg === '--runInBand') {
    return ['--maxWorkers=1', '--no-file-parallelism'];
  }
  return [arg];
});

const result = spawnSync(vitestBin, ['run', ...mappedArgs], { stdio: 'inherit', cwd });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
