#!/usr/bin/env node
/*
 * Script para insertar sesiones de presupuestos en bulk a la base de datos del ERP.
 *
 * Soporta dos formatos de entrada:
 *   1) JSON con un array de sesiones.
 *   2) Excel (.xlsx) en el que la primera fila son los nombres de columna.
 *
 * Uso básico (JSON):
 *   node scripts/import-sesiones-bulk.js ./sesiones.json
 *
 * Uso con Excel (primera hoja):
 *   node scripts/import-sesiones-bulk.js ./sesiones.xlsx
 *
 * Opciones:
 *   --sheet=NombreHoja   -> Nombre de la hoja en Excel (por defecto primera).
 *   --map=column-map.json -> Mapa de columnas para adaptar encabezados del Excel.
 *
 * Ejemplo de column-map.json (cabeceras -> campos del ERP):
 * {
 *   "ID Negocio": "deal_id",
 *   "ID Producto": "deal_product_id",
 *   "Título": "nombre_cache",
 *   "Inicio": "fecha_inicio_utc",
 *   "Fin": "fecha_fin_utc",
 *   "Sala": "sala_id",
 *   "Dirección": "direccion",
 *   "Comentarios": "comentarios",
 *   "Estado": "estado",
 *   "Drive": "drive_url"
 * }
 *
 * Campos mínimos necesarios para cada fila:
 *   - deal_id (string)
 *   - deal_product_id (string)
 *   - nombre_cache (string)
 *
 * Opcionales: fecha_inicio_utc, fecha_fin_utc, sala_id, direccion,
 *             comentarios, estado (SessionEstado), drive_url.
 *
 * DATABASE_URL debe apuntar a la base de datos destino.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { PrismaClient } = require('@prisma/client');

const args = process.argv.slice(2);
const inputPath = args[0];
const options = args.slice(1).reduce(
  (acc, arg) => {
    if (arg.startsWith('--sheet=')) {
      acc.sheet = arg.replace('--sheet=', '');
    }
    if (arg.startsWith('--map=')) {
      acc.mapPath = arg.replace('--map=', '');
    }
    return acc;
  },
  { sheet: null, mapPath: null }
);

if (!inputPath) {
  console.error('Falta la ruta del fichero JSON o Excel con las sesiones.');
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), inputPath);
if (!fs.existsSync(absolutePath)) {
  console.error(`No se encontró el fichero: ${absolutePath}`);
  process.exit(1);
}

const columnAliases = {
  deal_id: ['deal_id', 'deal', 'negocio', 'id_negocio'],
  deal_product_id: ['deal_product_id', 'producto', 'id_producto'],
  nombre_cache: ['nombre_cache', 'titulo', 'título', 'nombre'],
  fecha_inicio_utc: ['fecha_inicio_utc', 'inicio', 'start', 'fecha_inicio'],
  fecha_fin_utc: ['fecha_fin_utc', 'fin', 'end', 'fecha_fin'],
  sala_id: ['sala_id', 'sala'],
  direccion: ['direccion', 'dirección'],
  comentarios: ['comentarios', 'notas', 'observaciones'],
  estado: ['estado', 'status'],
  drive_url: ['drive_url', 'drive', 'url_drive'],
  id: ['id', 'sesion_id', 'session_id'],
};

function readColumnMap(mapPath) {
  if (!mapPath) return null;
  const resolved = path.resolve(process.cwd(), mapPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`No se encontró el fichero de mapeo de columnas: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  return JSON.parse(content);
}

function loadFromJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('El JSON debe ser un array de sesiones.');
  }
  return parsed;
}

function excelDateToJsDate(excelValue) {
  const parsed = XLSX.SSF.parse_date_code(excelValue);
  if (!parsed) return null;
  const { y, m, d, H, M, S } = parsed;
  return new Date(Date.UTC(y, m - 1, d, H ?? 0, M ?? 0, S ?? 0));
}

function normalizeDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') return excelDateToJsDate(value);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sheetToRows(filePath, sheetName) {
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const chosenSheet = sheetName ?? workbook.SheetNames[0];
  if (!chosenSheet || !workbook.Sheets[chosenSheet]) {
    throw new Error(`No se encontró la hoja "${sheetName}" en el Excel.`);
  }
  return XLSX.utils.sheet_to_json(workbook.Sheets[chosenSheet], {
    defval: null,
    raw: true,
    blankrows: false,
  });
}

function resolveValue(row, targetKey, columnMap) {
  if (columnMap) {
    const sourceKey = Object.keys(columnMap).find((source) => columnMap[source] === targetKey);
    if (sourceKey && row[sourceKey] !== undefined) return row[sourceKey];
  }

  const aliases = columnAliases[targetKey] ?? [];
  const rowEntries = Object.entries(row);
  for (const [key, value] of rowEntries) {
    const normalizedKey = key.trim().toLowerCase();
    if (aliases.includes(normalizedKey)) return value;
    if (normalizedKey === targetKey) return value;
  }
  return row[targetKey];
}

function normalizeRow(row, index, columnMap) {
  const requiredFields = ['deal_id', 'deal_product_id', 'nombre_cache'];
  const normalized = requiredFields.reduce((acc, field) => {
    acc[field] = resolveValue(row, field, columnMap);
    return acc;
  }, {});

  for (const field of requiredFields) {
    if (!normalized[field]) {
      throw new Error(`La fila ${index + 1} no tiene el campo obligatorio ${field}.`);
    }
  }

  return {
    id: resolveValue(row, 'id', columnMap) ?? undefined,
    deal_id: normalized.deal_id,
    deal_product_id: normalized.deal_product_id,
    nombre_cache: normalized.nombre_cache,
    fecha_inicio_utc: normalizeDate(resolveValue(row, 'fecha_inicio_utc', columnMap)),
    fecha_fin_utc: normalizeDate(resolveValue(row, 'fecha_fin_utc', columnMap)),
    sala_id: resolveValue(row, 'sala_id', columnMap) ?? null,
    direccion: resolveValue(row, 'direccion', columnMap) ?? '',
    comentarios: resolveValue(row, 'comentarios', columnMap) ?? null,
    estado: resolveValue(row, 'estado', columnMap) ?? undefined,
    drive_url: resolveValue(row, 'drive_url', columnMap) ?? null,
  };
}

async function main() {
  const extension = path.extname(absolutePath).toLowerCase();
  const columnMap = readColumnMap(options.mapPath);

  const sourceRows =
    extension === '.xlsx' || extension === '.xls'
      ? sheetToRows(absolutePath, options.sheet)
      : loadFromJson(absolutePath);

  const prisma = new PrismaClient();

  try {
    const payload = sourceRows.map((row, index) => normalizeRow(row, index, columnMap));

    const result = await prisma.sesiones.createMany({
      data: payload,
      skipDuplicates: true,
    });

    console.log(`Sesiones insertadas: ${result.count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
