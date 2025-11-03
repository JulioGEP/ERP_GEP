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

const { __test__ } = require('../sessions.ts');

Module._resolveFilename = originalResolveFilename;

test('in-company sessions become planificada without sala when trainers and units exist', () => {
  const start = new Date('2025-03-03T08:00:00.000Z');
  const end = new Date('2025-03-03T17:00:00.000Z');

  const rawSession = {
    id: 'session-1',
    deal_id: 'deal-1',
    deal_product_id: 'product-1',
    nombre_cache: 'Formación',
    fecha_inicio_utc: start,
    fecha_fin_utc: end,
    sala_id: null,
    direccion: "Carrer d'Apolo, Terrassa",
    estado: 'BORRADOR',
    drive_url: null,
    sesion_trainers: [{ trainer_id: 'trainer-1' }],
    sesion_unidades: [{ unidad_movil_id: 'unit-1' }],
    deals: { sede_label: 'In Company', pipeline_id: 'formacion empresa' },
  };

  const normalized = __test__.ensureSessionRelations(rawSession);
  assert.equal(normalized.deal?.sede_label, 'In Company');

  const estado = __test__.resolveSessionEstado(normalized);
  assert.equal(estado, 'PLANIFICADA');
});

test('normalizeSedeLabel maps uppercase in company labels', () => {
  assert.equal(__test__.normalizeSedeLabel('IN COMPANY'), 'In Company');
  assert.equal(__test__.normalizeSedeLabel('In company'), 'In Company');
  assert.equal(__test__.normalizeSedeLabel('in company - unidad movil'), 'In Company');
});
