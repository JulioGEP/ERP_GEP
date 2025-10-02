# ERP_GEP

ERP interno para planificación, visualización y gestión de formaciones procedentes de Pipedrive.  
Este proyecto integra **Frontend React** y **Backend vía Netlify Functions** con conexión a **Neon PostgreSQL** a través de **Prisma ORM**.

---

## 📦 Stack tecnológico

- **Frontend**: React + Vite + TypeScript + React-Bootstrap
- **Backend**: Netlify Functions (Node.js, TypeScript, AWS SDK v3)
- **DB**: PostgreSQL (Neon) gestionada con **Prisma ORM**
- **Infra**: Netlify (build y deploy)

---

## 🔧 Configuración TypeScript

Se ha unificado la configuración TS para Functions en `netlify/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["functions/**/*.ts"],
  "exclude": ["node_modules", "**/dist"]
}
✔ Eliminados tsconfig.json duplicados.
✔ Añadido jsconfig.json para silenciar errores fantasma en .js legacy.
✔ Añadido .vscode/settings.json para desactivar validación JS innecesaria.

🗂️ Estructura del proyecto
java
Copiar código
frontend/                 → App React (Vite, Bootstrap, React Query)
netlify/functions/        → Funciones serverless
  ├── deals.ts            → CRUD + importación de deals desde Pipedrive
  ├── deal_documents.ts   → Gestión de documentos en S3 (upload, download, delete)
  ├── _lib/               → Librerías internas (db.ts, http.ts)
  ├── _shared/            → Código común
       ├── prisma.ts      → Singleton de Prisma
       ├── response.ts    → Helpers para respuestas HTTP
       ├── env.js         → Variables de entorno
       ├── dealPayload.js → Payloads de deals (legacy, pendiente de refactor)
prisma/schema.prisma      → Definición de modelos de BD
netlify.toml              → Configuración Netlify (build, funciones, publish)
🛠️ Cambios recientes
1. Migración a TypeScript ESM en Functions
Sustituido require → import/export.

moduleResolution cambiado a "Bundler" (Netlify + esbuild).

2. Prisma
Eliminado prisma.js con tipos mal colocados.

Nuevo singleton en netlify/functions/_shared/prisma.ts:

ts
Copiar código
import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

/**
 * Devuelve una única instancia de PrismaClient.
 */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
    });
  }
  return prisma;
}
3. Deals (deals.ts)
Corregido organization (antes se usaba organizations que no existía).

hours y alumnos: Prisma los define como string, en la app se manejan como number.

Endpoint /deals/import: importa desde Pipedrive y hace upsert en BD.

Fallback de hours: si no existe a nivel deal, se calcula desde productos.

4. Deal Documents (deal_documents.ts)
AWS SDK actualizado a v3:

ts
Copiar código
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
Endpoints soportados:

POST /upload-url → URL firmada para subida.

POST → Guardar metadatos en BD (deal_files).

GET /:docId/url → URL firmada para descarga.

DELETE → Borrado en S3 + BD.

5. Limpieza
Eliminados tsconfig.json duplicados.

Eliminado prisma.js residual.

Normalización de imports en todos los ficheros de Functions.

🚀 Scripts útiles
bash
Copiar código
# Instalar dependencias
npm ci

# Generar Prisma client
npm run generate

# Typecheck funciones
npm run typecheck:functions

# Build frontend
npm run build:frontend

# Build completo (Netlify)
netlify build
📑 API Endpoints
Deals (deals.ts)
1. Importar deal desde Pipedrive
http
Copiar código
POST /.netlify/functions/deals/import
Content-Type: application/json

{
  "dealId": "123"
}
📤 Response

json
Copiar código
{
  "ok": true,
  "deal": {
    "deal_id": "123",
    "title": "Formación PCI",
    "organization": { "org_id": "456", "name": "Empresa SA" },
    "person": { "person_id": "789", "name": "Juan Pérez", "email": "juan@test.com" }
  }
}
2. Obtener listado de deals (tabla presupuestos)
http
Copiar código
GET /.netlify/functions/deals?noSessions=true
📤 Response

json
Copiar código
{
  "deals": [
    {
      "deal_id": "123",
      "title": "Formación PCI",
      "sede_label": "Barcelona",
      "hours": 20,
      "organization": { "org_id": "456", "name": "Empresa SA" },
      "person": { "person_id": "789", "first_name": "Juan", "last_name": "Pérez" }
    }
  ]
}
3. Obtener detalle de un deal
http
Copiar código
GET /.netlify/functions/deals/123
📤 Response

json
Copiar código
{
  "deal": {
    "deal_id": "123",
    "title": "Formación PCI",
    "organization": { "org_id": "456", "name": "Empresa SA" },
    "deal_products": [
      { "id": "1", "name": "Curso 10h", "hours": 10 },
      { "id": "2", "name": "Curso 10h", "hours": 10 }
    ],
    "hours": 20
  }
}
4. Editar deal (campos editables)
http
Copiar código
PATCH /.netlify/functions/deals/123
Content-Type: application/json

{
  "deal": {
    "hours": 30,
    "alumnos": 12
  },
  "comments": {
    "create": [{ "content": "Ajustado número de horas" }]
  }
}
Deal Documents (deal_documents.ts)
1. Generar URL firmada para subida
http
Copiar código
POST /.netlify/functions/deal_documents/123/upload-url
Content-Type: application/json

{
  "fileName": "programa.pdf",
  "mimeType": "application/pdf",
  "fileSize": 102400
}
📤 Response

json
Copiar código
{
  "ok": true,
  "uploadUrl": "https://s3.amazonaws.com/...firmada...",
  "storageKey": "deals/123/abc123.pdf"
}
2. Guardar metadatos del documento
http
Copiar código
POST /.netlify/functions/deal_documents/123
Content-Type: application/json

{
  "file_name": "programa.pdf",
  "storage_key": "deals/123/abc123.pdf"
}
📤 Response

json
Copiar código
{ "ok": true, "id": "doc-uuid" }
3. Generar URL firmada para descarga
http
Copiar código
GET /.netlify/functions/deal_documents/123/doc-uuid/url
📤 Response

json
Copiar código
{
  "ok": true,
  "url": "https://s3.amazonaws.com/...firmada..."
}
4. Borrar documento
http
Copiar código
DELETE /.netlify/functions/deal_documents/123/doc-uuid
📤 Response

json
Copiar código
{ "ok": true }
✅ Estado actual
Frontend: vite build OK

Backend Functions: Compila con TS (solo warnings menores resueltos)

Prisma: prisma generate OK

Netlify Deploy: Funcional, corrigiendo imports y organization
