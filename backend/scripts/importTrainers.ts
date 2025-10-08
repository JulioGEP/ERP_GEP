import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import path from "path";

const prisma = new PrismaClient();

async function main() {
  const filePath = path.resolve(__dirname, "../data/formadores.xlsx");
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  console.log(`📦 Cargando ${data.length} registros desde Excel...`);

  for (const row of data) {
    const nombre = String(row["Nombre"] || "").trim();
    const apellido = String(row["Apellido"] || "").trim();
    const email = String(row["Email"] || "").trim().toLowerCase();
    const telefono = String(row["Teléfono"] || "").trim();
    const dni = String(row["DNI"] || "").trim();
    const direccion = String(row["Dirección"] || "").trim();
    const especialidad = String(row["Especialidad"] || "").trim();
    const titulacion = String(row["Titulación"] || "").trim();
    const activo =
      row["Activo"]?.toString().toLowerCase().includes("no") ? false : true;

    if (!nombre && !email) {
      console.warn("⚠️  Fila ignorada (sin nombre ni email):", row);
      continue;
    }

    await prisma.trainers.upsert({
      where: { email },
      update: {
        name: nombre || undefined,
        apellido: apellido || undefined,
        phone: telefono || undefined,
        dni: dni || undefined,
        direccion: direccion || undefined,
        especialidad: especialidad || undefined,
        titulacion: titulacion || undefined,
        activo,
        updated_at: new Date(),
      },
      create: {
        name: nombre,
        apellido: apellido || null,
        email,
        phone: telefono || null,
        dni: dni || null,
        direccion: direccion || null,
        especialidad: especialidad || null,
        titulacion: titulacion || null,
        activo,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  console.log("✅ Importación completada correctamente.");
}

main()
  .catch((e) => {
    console.error("❌ Error en la importación:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
