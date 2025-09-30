const { PrismaClient } = require('@prisma/client');
const { requireEnv } = require('./env');

function createPrismaClient() {
  requireEnv('DATABASE_URL');

  return new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn']
  });
}

const globalForPrisma = globalThis;
let prisma = globalForPrisma.__erp_gep_prisma;

function getPrisma() {
  if (!prisma) {
    prisma = createPrismaClient();
    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.__erp_gep_prisma = prisma;
    }
  }

  return prisma;
}

module.exports = {
  getPrisma,
  get prisma() {
    return getPrisma();
  }
};
