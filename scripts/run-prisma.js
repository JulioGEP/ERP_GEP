#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-prisma.js <command> [args...]');
  process.exit(1);
}

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const env = { ...process.env, PRISMA_SCHEMA_PATH: schemaPath };
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const child = spawn(command, ['prisma', ...args], {
  stdio: 'inherit',
  env
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
