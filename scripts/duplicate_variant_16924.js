#!/usr/bin/env node
// Script to duplicate the Sabadell variant for product/variant Woo ID 16924 across multiple dates.
// Usage: DATABASE_URL=... WOO_BASE_URL=... WOO_KEY=... WOO_SECRET=... node scripts/duplicate_variant_16924.js

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PRODUCT_WOO_ID = 16924n;
const SEDE = 'Sabadell';
const TARGET_DATES = [
  '27/05/2025',
  '03/06/2025',
  '10/06/2025',
  '17/06/2025',
  '01/07/2025',
  '08/07/2025',
  '15/07/2025',
  '22/07/2025',
  '09/09/2025',
  '16/09/2025',
  '25/09/2025',
  '30/09/2025',
  '07/10/2025',
  '14/10/2025',
  '21/10/2025',
  '28/10/2025',
  '04/11/2025',
  '11/11/2025',
  '18/11/2025',
  '25/11/2025',
  '02/12/2025',
  '09/12/2025',
  '16/12/2025',
  '13/01/2026',
  '20/01/2026',
  '27/01/2026',
  '03/02/2026',
  '10/02/2026',
  '17/02/2026',
  '24/02/2026',
  '03/03/2026',
  '10/03/2026',
];

function ensureEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}

function mapDbStockStatusToApiValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === 'sin valor') return null;
  if (normalized === 'en stock' || normalized === 'instock') return 'instock';
  if (normalized === 'sin stock' || normalized === 'outofstock') return 'outofstock';
  if (normalized === 'reservar por adelantado' || normalized === 'onbackorder') return 'onbackorder';
  return null;
}

function getWooStockStatusFromDb(value) {
  return mapDbStockStatusToApiValue(value) || 'instock';
}

function parseDdMmYyyy(value) {
  const [day, month, year] = value.split('/').map((part) => Number.parseInt(part, 10));
  if (!day || !month || !year) {
    throw new Error(`Invalid date format: ${value}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateAttributeValue(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function createWooVariation(productWooId, sede, displayDate, priceText, stockStatus, stockQuantity, metaData) {
  const base = ensureEnv('WOO_BASE_URL').replace(/\/$/, '');
  const key = ensureEnv('WOO_KEY');
  const secret = ensureEnv('WOO_SECRET');

  const url = `${base}/wp-json/wc/v3/products/${productWooId}/variations`;
  const token = Buffer.from(`${key}:${secret}`).toString('base64');

  const payload = {
    status: 'publish',
    regular_price: priceText,
    price: priceText,
    stock_status: stockStatus,
    attributes: [
      { name: 'Sede', option: sede },
      { name: 'Fecha', option: displayDate },
    ],
  };

  if (stockQuantity != null) {
    payload.manage_stock = true;
    payload.stock_quantity = stockQuantity;
  } else {
    payload.manage_stock = false;
  }

  if (metaData.length) {
    payload.meta_data = metaData;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WooCommerce error ${response.status}: ${text}`);
  }

  return response.json();
}

async function main() {
  const product = await prisma.products.findUnique({
    where: { id_woo: PRODUCT_WOO_ID },
    select: {
      id_woo: true,
      name: true,
      default_variant_price: true,
      default_variant_stock_status: true,
      default_variant_stock_quantity: true,
      default_variant_start: true,
      default_variant_end: true,
    },
  });

  if (!product) {
    throw new Error(`Producto con ID Woo ${PRODUCT_WOO_ID} no encontrado en la base de datos.`);
  }

  if (!product.default_variant_price) {
    throw new Error('El producto no tiene configurado un precio por defecto para variantes.');
  }

  const priceText = product.default_variant_price.toString();
  const stockStatus = getWooStockStatusFromDb(product.default_variant_stock_status);
  const stockQuantity = product.default_variant_stock_quantity ?? null;

  const metaData = [];
  if (product.default_variant_start) {
    metaData.push({ key: 'start_date', value: formatDateAttributeValue(product.default_variant_start) });
  }
  if (product.default_variant_end) {
    metaData.push({ key: 'end_date', value: formatDateAttributeValue(product.default_variant_end) });
  }

  for (const displayDate of TARGET_DATES) {
    const dateValue = parseDdMmYyyy(displayDate);
    const existing = await prisma.variants.findFirst({
      where: {
        id_padre: PRODUCT_WOO_ID,
        sede: SEDE,
        date: dateValue,
      },
      select: { id_woo: true, name: true },
    });

    if (existing) {
      console.log(`Omitido ${displayDate}: ya existe la variante ${existing.name ?? existing.id_woo}.`);
      continue;
    }

    console.log(`Creando variante ${displayDate} (${SEDE})...`);
    const wooVariant = await createWooVariation(
      PRODUCT_WOO_ID.toString(),
      SEDE,
      displayDate,
      priceText,
      stockStatus,
      stockQuantity,
      metaData,
    );

    if (!wooVariant?.id) {
      throw new Error('WooCommerce no devolvió un identificador para la variante creada.');
    }

    const createdAt = wooVariant.date_created_gmt ? new Date(wooVariant.date_created_gmt) : new Date();
    const updatedAt = wooVariant.date_modified_gmt ? new Date(wooVariant.date_modified_gmt) : createdAt;

    await prisma.variants.create({
      data: {
        id_woo: BigInt(wooVariant.id),
        id_padre: PRODUCT_WOO_ID,
        name: wooVariant.name ?? `${SEDE} - ${displayDate}`,
        status: wooVariant.status ?? 'publish',
        finalizar: 'Activa',
        price: product.default_variant_price,
        stock: stockQuantity,
        stock_status: wooVariant.stock_status ?? stockStatus,
        sede: SEDE,
        date: dateValue,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    });

    console.log(`Variante ${displayDate} creada con ID Woo ${wooVariant.id}.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
