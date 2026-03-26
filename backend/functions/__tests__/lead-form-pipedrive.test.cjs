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


test('buildLeadPayload applies GEP Services custom lead fields', () => {
  const payload = __test__.buildLeadPayload(
    {
      websiteLabel: 'GEP Services',
      companyType: null,
      companyName: 'Empresa servicios',
      leadName: 'Laura Pérez',
      leadEmail: 'laura@empresa.es',
      leadPhone: '600111222',
      leadMessage: 'Necesito información del servicio',
      courseName: null,
      siteName: null,
      trafficSource: 'google',
      formName: 'Contacto servicios',
      source: 'wordpress',
      serviceName: 'PCI',
    },
    '456',
    '123',
    { serviceTypeOptionId: 999 },
  );

  assert.equal(payload.title, 'GS - Empresa servicios');
  assert.equal(payload.note, undefined);
  assert.equal(payload.person_id, 123);
  assert.equal(payload.organization_id, 456);
  assert.equal(payload['ce2c299bd19c48d40297cd7b204780585ab2a5f0'], '63');
  assert.equal(payload['e72120b9e27221b560c8480ff422f3fe28f8dbae'], '234');
  assert.equal(payload['abfa216589d01466453514fdcfeb1c6e5b9fdf8d'], 'google');
  assert.equal(payload['c6eabce7c04f864646aa72c944f875fd71cdf178'], 'Web');
  assert.equal(payload['bcc13ba7981730831a71700fcd52488f13c2112f'], 'Web');
  assert.equal(payload['35d37547db294a690fb087e3d86b30471f057186'], 'Directa');
  assert.equal(payload['1d78d202448ee549a86e0881ec06f3ff7842c5ea'], 999);
});

test('buildLeadNotePayload prepares the note for the Notes API instead of the lead payload', () => {
  const payload = __test__.buildLeadNotePayload(
    'lead-123',
    {
      websiteLabel: 'GEP Services',
      companyType: null,
      companyName: 'Empresa servicios',
      leadName: 'Laura Pérez',
      leadEmail: 'laura@empresa.es',
      leadPhone: '600111222',
      leadMessage: 'Necesito información del servicio',
      courseName: null,
      siteName: null,
      trafficSource: 'google',
      formName: 'Contacto servicios',
      source: 'wordpress',
      serviceName: 'PCI',
    },
    '123',
    '456',
  );

  assert.deepEqual(payload, {
    content: 'Necesito información del servicio',
    lead_id: 'lead-123',
    person_id: 123,
    org_id: 456,
    pinned_to_lead_flag: 1,
    pinned_to_person_flag: 1,
    pinned_to_organization_flag: 1,
  });
});

test('isOpenTrainingBudgetLead detects GEPCO individuals for open training budgets', () => {
  assert.equal(
    __test__.isOpenTrainingBudgetLead({
      websiteLabel: 'GEPCO',
      companyType: 'Individual / Autónomo / Particulares',
      companyName: null,
      leadName: 'Álvaro',
      leadEmail: 'alvaro@example.com',
      leadPhone: '600000000',
      leadMessage: null,
      courseName: 'Curso primeros auxilios',
      siteName: 'Madrid',
      trafficSource: 'google',
      formName: 'Lead',
      source: 'wordpress',
      serviceName: null,
    }),
    true,
  );

  assert.equal(
    __test__.isOpenTrainingBudgetLead({
      websiteLabel: 'GEPCO',
      companyType: 'Empresa que quiere formar a menos de 5 personas',
      companyName: null,
      leadName: 'Álvaro',
      leadEmail: 'alvaro@example.com',
      leadPhone: '600000000',
      leadMessage: null,
      courseName: 'Curso primeros auxilios',
      siteName: 'Madrid',
      trafficSource: 'google',
      formName: 'Lead',
      source: 'wordpress',
      serviceName: null,
    }),
    false,
  );
});

test('buildOpenTrainingDealPayload creates a formación abierta deal instead of a lead', () => {
  const payload = __test__.buildOpenTrainingDealPayload(
    {
      websiteLabel: 'GEPCO',
      companyType: 'Individual / Autónomo / Particulares',
      companyName: 'Empresa demo',
      leadName: 'Julio Garcia',
      leadEmail: 'julio@gepgroup.es',
      leadPhone: '600000000',
      leadMessage: 'Hola',
      courseName: 'Curso primeros auxilios',
      siteName: 'Madrid',
      trafficSource: 'google',
      formName: 'Contacto',
      source: 'wordpress',
      serviceName: null,
    },
    '456',
    '123',
    {
      trainingOptionId: 901,
      siteOptionId: 902,
      trainingLookupLabel: 'Curso primeros auxilios',
      siteLookupLabel: 'Madrid',
    },
  );

  assert.equal(payload.title, 'GC- Julio Garcia');
  assert.equal(payload.status, 'open');
  assert.equal(payload.pipeline_id, '3');
  assert.equal(payload.stage_id, '13');
  assert.equal(payload.org_id, 456);
  assert.equal(payload.person_id, 123);
  assert.equal(payload['e72120b9e27221b560c8480ff422f3fe28f8dbae'], '234');
  assert.equal(payload['676d6bd51e52999c582c01f67c99a35ed30bf6ae'], 902);
  assert.equal(payload['c99554c188c3f63ad9bc8b2cf7b50cbd145455ab'], 901);
  assert.equal(payload['ce2c299bd19c48d40297cd7b204780585ab2a5f0'], '64');
  assert.equal(payload['245d60d4d18aec40ba888998ef92e5d00e494583'], '85');
  assert.equal(payload['e1971bf3a21d48737b682bf8d864ddc5eb15a351'], '25');
  assert.equal(payload['abfa216589d01466453514fdcfeb1c6e5b9fdf8d'], 'google');
  assert.equal(payload['c6eabce7c04f864646aa72c944f875fd71cdf178'], 'Lead Web');
  assert.equal(payload['8a65e9b780cbab3f08ccc8babe92a290fb79f216'], undefined);
  assert.equal(payload['6eb20e6b912f055c127241c9012f20a8223637f6'], undefined);
  assert.equal(payload['99554c188c3f63ad9bc8b2cf7b50cbd145455ab'], undefined);
});

test('buildOrganizationPayload sets address and CIF defaults for GEPCO individuals', () => {
  const payload = __test__.buildOrganizationPayload({
    websiteLabel: 'GEPCO',
    companyType: 'Individual / Autónomo / Particulares',
    companyName: 'No disponible',
    leadName: 'Julio Garcia',
    leadEmail: 'julio@gepgroup.es',
    leadPhone: '600000000',
    leadMessage: 'Hola',
    courseName: 'Curso primeros auxilios',
    siteName: 'Madrid',
    trafficSource: 'google',
    formName: 'Contacto',
    source: 'wordpress',
    serviceName: null,
  });

  assert.equal(payload.name, 'No disponible');
  assert.equal(payload.address, 'No disponible');
  assert.equal(payload['6d39d015a33921753410c1bab0b067ca93b8cf2c'], 'No disponible');
  assert.equal(payload['8a65e9b780cbab3f08ccc8babe92a290fb79f216'], 241);
  assert.equal(payload['6eb20e6b912f055c127241c9012f20a8223637f6'], 139);
});

test('buildOpenTrainingDealProductPayload prepares the deal product line with quantity 1', () => {
  const payload = __test__.buildOpenTrainingDealProductPayload({
    idPipe: '203',
    productName: 'Curso PAUX',
    price: 185,
  });

  assert.deepEqual(payload, {
    product_id: 203,
    item_price: 185,
    quantity: 1,
    tax_method: 'exclusive',
    is_enabled: true,
  });
});

test('buildSlackMessage omits Pipedrive IDs and updates text for GEPCO leads', () => {
  const message = __test__.buildSlackMessage(
    {
      websiteLabel: 'GEPCO',
      companyType: 'Empresa',
      companyName: 'Empresa demo',
      leadName: 'Julio Garcia',
      leadEmail: 'julio@gepgroup.es',
      leadPhone: '600000000',
      leadMessage: 'Hola',
      courseName: 'Curso PAUX',
      siteName: 'Madrid',
      trafficSource: 'google',
      formName: 'Contacto',
      source: 'wordpress',
      serviceName: null,
    },
    {
      leadId: 'lead-1',
      personId: '123',
      organizationId: '456',
      warnings: [],
      normalizedPayload: {},
    },
  );

  assert.match(message, /Nuevo lead de GEPCO\./);
  assert.doesNotMatch(message, /Prospecto Pipedrive:/);
  assert.doesNotMatch(message, /Organización Pipedrive:/);
  assert.doesNotMatch(message, /Persona Pipedrive:/);
});


test('buildSlackMessage for GEPCO open training keeps budget id but omits organization/person ids', () => {
  const message = __test__.buildSlackMessage(
    {
      websiteLabel: 'GEPCO',
      companyType: 'Individual / Autónomo / Particulares',
      companyName: 'Empresa demo',
      leadName: 'Julio Garcia',
      leadEmail: 'julio@gepgroup.es',
      leadPhone: '600000000',
      leadMessage: 'Hola',
      courseName: 'Curso PAUX',
      siteName: 'Madrid',
      trafficSource: 'google',
      formName: 'Contacto',
      source: 'wordpress',
      serviceName: null,
    },
    {
      leadId: 'lead-1',
      personId: '123',
      organizationId: '456',
      warnings: [],
      normalizedPayload: {},
    },
  );

  assert.match(message, /Nuevo lead de GEPCO\./);
  assert.match(message, /Presupuesto Pipedrive: lead-1/);
  assert.doesNotMatch(message, /Organización Pipedrive:/);
  assert.doesNotMatch(message, /Persona Pipedrive:/);
});

test('buildSlackMessage for GEP Services includes Servicio and omits training and Pipedrive fields', () => {
  const message = __test__.buildSlackMessage(
    {
      websiteLabel: 'GEP Services',
      companyType: 'Empresa',
      companyName: 'Empresa servicios',
      leadName: 'Laura Pérez',
      leadEmail: 'laura@empresa.es',
      leadPhone: '600111222',
      leadMessage: 'Necesito información del servicio',
      courseName: 'Curso X',
      siteName: 'Barcelona',
      trafficSource: 'google',
      formName: 'Contacto servicios',
      source: 'wordpress',
      serviceName: 'PCI',
    },
    {
      leadId: 'lead-1',
      personId: '123',
      organizationId: '456',
      warnings: [],
      normalizedPayload: {},
    },
  );

  assert.match(message, /Nuevo de GEP Services\./);
  assert.match(message, /Servicio: PCI/);
  assert.doesNotMatch(message, /Tipo:/);
  assert.doesNotMatch(message, /Curso:/);
  assert.doesNotMatch(message, /Sede:/);
  assert.doesNotMatch(message, /Prospecto Pipedrive:/);
  assert.doesNotMatch(message, /Organización Pipedrive:/);
  assert.doesNotMatch(message, /Persona Pipedrive:/);
});

test('resolveSlackChannelId routes GEPCO individual leads to formaciones_abiertas channel', () => {
  const channelId = __test__.resolveSlackChannelId({
    websiteLabel: 'GEPCO',
    companyType: 'Individual / Autónomo / Particulares',
    companyName: 'Empresa demo',
    leadName: 'Julio Garcia',
    leadEmail: 'julio@gepgroup.es',
    leadPhone: '600000000',
    leadMessage: 'Hola',
    courseName: 'Curso PAUX',
    siteName: 'Madrid',
    trafficSource: 'google',
    formName: 'Contacto',
    source: 'wordpress',
    serviceName: null,
  });

  assert.equal(channelId, 'C06P4G70GJD');
});

test('resolveSlackChannelId keeps default channel for non-open-training leads', () => {
  const channelId = __test__.resolveSlackChannelId({
    websiteLabel: 'GEPCO',
    companyType: 'Empresa que quiere formar a menos de 5 personas',
    companyName: 'Empresa demo',
    leadName: 'Julio Garcia',
    leadEmail: 'julio@gepgroup.es',
    leadPhone: '600000000',
    leadMessage: 'Hola',
    courseName: 'Curso PAUX',
    siteName: 'Madrid',
    trafficSource: 'google',
    formName: 'Contacto',
    source: 'wordpress',
    serviceName: null,
  });

  assert.equal(channelId, 'C05PBDREZ54');
});
