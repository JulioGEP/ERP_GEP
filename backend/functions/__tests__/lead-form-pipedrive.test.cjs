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

const { __test__ } = require('../_shared/lead-form-pipedrive.ts');

Module._resolveFilename = originalResolveFilename;

test('readInteger converts numeric strings into integers', () => {
  assert.equal(__test__.readInteger('12345'), 12345);
  assert.equal(__test__.readInteger(678), 678);
  assert.equal(__test__.readInteger(''), null);
  assert.equal(__test__.readInteger('abc'), null);
  assert.equal(__test__.readInteger('12.5'), null);
});

test('buildLeadPayload sends numeric person_id and organization_id values to Pipedrive', () => {
  const payload = __test__.buildLeadPayload(
    {
      websiteLabel: 'GEPCO',
      companyType: null,
      companyName: 'Empresa demo',
      leadName: 'Julio Garcia',
      leadEmail: 'julio@gepgroup.es',
      leadPhone: '600000000',
      leadMessage: 'Hola',
      courseName: null,
      siteName: null,
      trafficSource: null,
      formName: 'Contacto',
      source: 'wordpress',
    },
    '456',
    '123',
  );

  assert.equal(payload.person_id, 123);
  assert.equal(payload.organization_id, 456);
  assert.equal(payload.visible_to, '7');
});

test('parseVisibilityEnv keeps only supported Pipedrive visibility values', () => {
  assert.equal(__test__.parseVisibilityEnv('1', '7'), '1');
  assert.equal(__test__.parseVisibilityEnv('3', '7'), '3');
  assert.equal(__test__.parseVisibilityEnv('5', '7'), '5');
  assert.equal(__test__.parseVisibilityEnv('7', '1'), '7');
  assert.equal(__test__.parseVisibilityEnv('9', '7'), '7');
  assert.equal(__test__.parseVisibilityEnv(undefined, '5'), '5');
});
