ERP_GEP

ERP interno colaborativo para planificar, visualizar y gestionar formaciones de GEP Group, sincronizado con Pipedrive y desplegado en Netlify.

🚀 Visión

La aplicación permite:

Importar datos desde Pipedrive (deals, organizaciones, personas, productos, notas y ficheros).

Planificar sesiones de formación, recursos y presupuestos.

Visualizar la información en tiempo real para varios usuarios.

Exponer una API interna mediante Netlify Functions.

📂 Estructura del monorepo
ERP_GEP/
├─ frontend/                        # App React + Vite + TypeScript
│  ├─ public/
│  │  └─ _redirects                 # (opcional) Alias /api/* → /.netlify/functions/:splat
│  └─ src/
│     └─ features/presupuestos/
│        ├─ BudgetTable.tsx
│        ├─ BudgetDetailModal.tsx
│        ├─ BudgetImportModal.tsx
│        └─ api.ts                  # Cliente API → /.netlify/functions/*
│     ├─ App.tsx
│     ├─ vite-env.d.ts
│     └─ types/deal.ts
│
├─ backend/
│  └─ functions/                    # Netlify Functions (Node 20, esbuild)
│     ├─ deals.ts                   # GET /deals..., POST /deals/import, PATCH /deals/:id
│     ├─ deal_documents.ts          # S3 presigned URLs (upload / get / delete)
│     ├─ health.ts                  # GET /health
│     └─ _shared/
│        ├─ response.ts             # JSON seguro (BigInt→string)
│        ├─ prisma.ts               # getPrisma()
│        ├─ pipedrive.ts            # Cliente Pipedrive centralizado + caché básica
│        └─ mappers.ts              # Mapeo/Upsert Deal + Org + Person + Productos + Notas + Ficheros
│
├─ prisma/
│  └─ schema.prisma                 # Esquema de BD (Neon u otro Postgres)
│
├─ netlify.toml                     # Build y Functions (directory = "backend/functions")
├─ package.json                     # Scripts raíz (generate/build)
└─ README.md


Nota: Históricamente la carpeta se llamó netlify/. Ahora es backend/. El prefijo público de Functions es siempre /.netlify/functions/*.

⚙️ Requisitos

Node.js ≥ 20.18.0 (usamos 20.19.x en CI)

npm ≥ 10.8.0

🔑 Variables de entorno

Defínelas en Netlify y en local (.env) según corresponda:

Base de datos

DATABASE_URL → cadena de conexión Postgres (Neon u otro)

Pipedrive

PIPEDRIVE_API_TOKEN → token API

PIPEDRIVE_BASE_URL → (opcional, por defecto https://api.pipedrive.com/v1)

S3 (documentos)

⚠️ Los nombres coinciden con el código actual de deal_documents.ts.

S3_BUCKET

S3_REGION

S3_ACCESS_KEY_ID

S3_SECRET_ACCESS_KEY

🖥️ Desarrollo local
1) Instalar dependencias
# en la raíz
npm install
cd frontend && npm install && cd ..


Prisma se genera en postinstall. Si necesitas forzarlo:

npx prisma generate --schema=prisma/schema.prisma

2) Levantar el frontend (Vite)
cd frontend
npm run dev
# http://localhost:5173

3) (Opcional) Functions en local con Netlify CLI
# requiere netlify-cli (vía npx o global)
npx netlify dev -p 8888
# expone frontend y /.netlify/functions/*

🏗️ Build y despliegue (Netlify)

netlify.toml (resumen):

[build]
command = "npm run netlify:build"
publish = "frontend/dist"

[functions]
directory = "backend/functions"


Scripts relevantes (raíz package.json):

{
  "scripts": {
    "generate": "prisma generate --schema=prisma/schema.prisma",
    "postinstall": "prisma generate --schema=prisma/schema.prisma",
    "build:frontend": "cd frontend && npm install && npm run build",
    "build": "npm run build:frontend",
    "netlify:build": "npm run generate && npm run build",
    "typecheck:functions": "tsc -p backend/tsconfig.json"
  }
}


Publicación:

Frontend → frontend/dist

API (Functions) → /.netlify/functions/*

Alias /api (opcional): si quieres usar /api/* como atajo, en frontend/public/_redirects:

/* /index.html 200
/api/* /.netlify/functions/:splat 200

🔌 Endpoints principales

Salud:

GET /.netlify/functions/health → { ok: true, ts }

Presupuestos:

GET /.netlify/functions/deals?noSessions=true → { deals: [...] }

GET /.netlify/functions/deals?dealId=7222 → { deal: {...} }

POST /.netlify/functions/deals/import (body: {"dealId":"7222"}) → { ok: true, deal: { deal_id, ... } }

PATCH /.netlify/functions/deals/:dealId → actualiza campos editables y comentarios

Documentos (S3):

POST /.netlify/functions/deal_documents/:dealId/upload-url → { uploadUrl, storageKey }

POST /.netlify/functions/deal_documents/:dealId → guarda metadatos (deal_files)

GET /.netlify/functions/deal_documents/:dealId/:docId/url → { url } (presigned GET)

DELETE /.netlify/functions/deal_documents/:dealId/:docId → borra S3 + BD

🧠 Lógica de importación / datos (resumen funcional)

Import por dealId (modal “Importar presupuesto”):

Upsert de Deal, Organización (name) y Persona (nombre, email, tel).

Productos del deal:

Se guarda quantity como “horas por producto” (provisional) leyendo el custom field 38f11c8876ecde803a027fbf3c9041fda2ae7eb7.

Si un producto no trae horas → 0 (editable posteriormente en el popup).

Notas del deal (orden desc).

Ficheros del deal (metadatos) + documentos S3 en un listado unificado en el modal.

Labels: se guardan como texto legible en BD para:

pipeline_id (se almacena el label, no el ID)

sede_label, caes_label, fundae_label, hotel_label, training_address

Campos editables desde la UI que no se sobrescriben en re-import:

sede_label, hours, training_address, caes_label, fundae_label, hotel_label, alumnos

Errores de import: warning no bloqueante; se persiste lo disponible.

⚠️ Provisional: “horas por producto” se mapean a deal_products.quantity hasta realizar la migración de esquema que añada hours y comments por línea.

🧩 UI / Frontend

BudgetTable: consume GET /deals?noSessions=true. Tiene fallback para recuperar datos directos si props llegan vacíos.

BudgetImportModal: usa POST /deals/import (corrige la ruta antigua deals_import).

BudgetDetailModal:

GET /deals?dealId=...

Edición de 7 campos (con PATCH /deals/:id) y comentarios.

Documentos: subida con presigned PUT a S3 + metadatos en BD; vista previa con presigned GET.

🧪 Comprobaciones rápidas
# Salud
curl -s 'http://localhost:8888/.netlify/functions/health' | jq

# Listado Presupuestos (tabla)
curl -s 'http://localhost:8888/.netlify/functions/deals?noSessions=true' | jq

# Detalle
curl -s 'http://localhost:8888/.netlify/functions/deals?dealId=7222' | jq

# Importación
curl -s -X POST 'http://localhost:8888/.netlify/functions/deals/import' \
  -H 'Content-Type: application/json' \
  --data '{"dealId":"7222"}' | jq


Cambia localhost:8888 por el dominio de Netlify tras el deploy.

🛠️ Desarrollo Backend / Prisma

Generar cliente Prisma

# desde la raíz
npx prisma generate --schema=prisma/schema.prisma


Chequeo de tipos Functions

cd backend
npx tsc --noEmit

🔁 Flujo de trabajo (Git)
# crear rama
git checkout -b fix/pipedrive-import-docs

# añadir y commitear
git add -A
git commit -m "fix(pipedrive): import robusto + labels legibles + docs S3"

# subir y crear PR
git push -u origin fix/pipedrive-import-docs
gh pr create --fill --web

🗺️ Roadmap breve

Webhook Pipedrive → import automático además del modo bajo demanda.

Migración de esquema:

deal_products: añadir hours y product_comments (y dejar quantity para cantidades reales).

deal_files: añadir origin (imported | user_upload).

Limpieza de columnas marcadas “eliminar” en el mapeo PDF.

Filtros en UI por typedealproducttype y category.

Planificador visual de sesiones por presupuesto.

Tests E2E básicos (importación y edición de campos).

📎 Notas técnicas

Serialización BigInt: el backend devuelve JSON con BigInt serializado a string (helpers en _shared/response.ts) para evitar errores de JSON.stringify.

Pipelines / Labels: pipeline_id en BD guarda el nombre del pipeline (label) para mostrarlo directamente en UI.

Caché Pipedrive: pipedrive.ts cachea pipelines, dealFields y productFields durante la vida de la función.
