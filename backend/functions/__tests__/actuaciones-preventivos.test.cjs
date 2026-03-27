require('ts-node/register/transpile-only');

const Module = require('module');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === '@prisma/client') {
    return path.resolve(__dirname, '__mocks__/prisma-client.ts');
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { __test__ } = require('../actuaciones-preventivos.ts');
Module._resolveFilename = originalResolveFilename;

test('asRequiredString trims values and rejects empty strings', () => {
  assert.equal(__test__.asRequiredString('  demo  '), 'demo');
  assert.equal(__test__.asRequiredString('   '), null);
  assert.equal(__test__.asRequiredString(123), null);
});

test('asInteger accepts non-negative numbers and truncates decimals', () => {
  assert.equal(__test__.asInteger('4'), 4);
  assert.equal(__test__.asInteger(8.9), 8);
  assert.equal(__test__.asInteger(-1), null);
  assert.equal(__test__.asInteger('abc'), null);
});
