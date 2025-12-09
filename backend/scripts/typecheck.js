#!/usr/bin/env node
const { spawnSync } = require('child_process');

const rawArgs = process.argv.slice(2);
const normalizedArgs = rawArgs.flatMap((arg) => {
  if (arg.startsWith('--pretty=')) {
    const value = arg.slice('--pretty='.length);
    return ['--pretty', value];
  }
  return [arg];
});

const result = spawnSync('tsc', ['-p', 'tsconfig.json', ...normalizedArgs], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
