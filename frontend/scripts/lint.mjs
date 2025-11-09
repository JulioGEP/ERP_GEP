import { spawnSync } from 'node:child_process';

const extraArgs = process.argv.slice(2);

if (extraArgs.length > 0) {
  console.warn('Aviso: argumentos adicionales ignorados por el lint:', extraArgs.join(' '));
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('npm', ['run', 'guard:no-ellipsis']);
run('npm', ['run', 'typecheck']);
