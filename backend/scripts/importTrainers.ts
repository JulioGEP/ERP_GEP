import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "path";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

function toBool(value: any): boolean {
  if (value === undefined || value === null) return true; // por defecto activo=true
  const s = String(value).trim().toLowerCase();
  if (["no", "false", "0", "n"].includes(s)) return false;
  return true;
}

async function main() {
  const filePath = path.resolve(__dirname, "../data/formadores.xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet);

  console.log(`📦 Detectadas ${rows.length} filas en Excel.`);

  for (const row of rows) {
    // Encabezados esperados (ajusta si cambian en el Excel):
    const nombre       = String(row["Nombre"] ?? row["name"] ?? "").trim();
    const apellido     = String(row["Apellido"] ?? "").trim();
    const email        = String(row["Email"] ?? row["email"] ?? "").trim().toLowerCase();
    const telefono     = String(row["Teléfono"] ?? row["phone"] ?? "").trim();
    const dni          = String(row["DNI"] ?? row["dni"] ?? "").trim();
    const direccion    = String(row["Dirección"] ?? row["direccion"] ?? "").trim();
    const especialidad = String(row["Especialidad"] ?? row["especialidad"] ?? "").trim();
    const titulacion   = String(row["Titulación"] ?? row["titulacion"] ?? "").trim();
    const activo       = toBool(row["Activo"] ?? row["activo"]);

    // Si no hay al menos nombre o (email/dni), ignoramos la fila
    if (!nombre && !email && !dni) {
      console.warn("⚠️  Fila ignorada: faltan identificadores mínimos.", row);
      continue;
    }

    // --- ESTRATEGIA UPSERT ---
    // 1) upsert por email si existe
    if (email) {
      await prisma.trainers.upsert({
        where: { email }, // requiere email @unique en Prisma/DB
        update: {
          name: nombre || undefined,
          apellido: apellido || null,
          phone: telefono || null,
          dni: dni || null,
          direccion: direccion || null,
          especialidad: especialidad || null,
          titulacion: titulacion || null,
          activo,
        },
        create: {
          trainer_id: randomUUID(),
          name: nombre || "(sin nombre)",
          apellido: apellido || null,
          email,
          phone: telefono || null,
          dni: dni || null,
          direccion: direccion || null,
          especialidad: especialidad || null,
          titulacion: titulacion || null,
          activo,
        },
      });
      console.log(`✏️  Upsert por email: ${email}`);
      continue;
    }

    // 2) si no hay email pero sí DNI, upsert por dni
    if (dni) {
      await prisma.trainers.upsert({
        where: { dni }, // requiere dni @unique en Prisma/DB
        update: {
          name: nombre || undefined,
          apellido: apellido || null,
          email: email || null,
          phone: telefono || null,
          direccion: direccion || null,
          especialidad: especialidad || null,
          titulacion: titulacion || null,
          activo,
        },
        create: {
          trainer_id: randomUUID(),
          name: nombre || "(sin nombre)",
          apellido: apellido || null,
          email: email || null,
          phone: telefono || null,
          dni,
          direccion: direccion || null,
          especialidad: especialidad || null,
          titulacion: titulacion || null,
          activo,
        },
      });
      console.log(`✏️  Upsert por DNI: ${dni}`);
      continue;
    }

    // 3) si no hay email ni DNI: creamos registro nuevo
    await prisma.trainers.create({
      data: {
        trainer_id: randomUUID(),
        name: nombre || "(sin nombre)",
        apellido: apellido || null,
        email: null,
        phone: telefono || null,
        dni: null,
        direccion: direccion || null,
        especialidad: especialidad || null,
        titulacion: titulacion || null,
        activo,
      },
    });
    console.log(`🆕 Creado sin email/dni: ${nombre}`);
  }

  console.log("✅ Importación completada correctamente.");
}

main()
  .catch((e) => {
    console.error("❌ Error en la importación:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
