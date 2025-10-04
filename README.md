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
│  └─ functions/                    # Netlify Functions (Node 22, esbuild)
│     ├─ deals.ts
│     ├─ deal_documents.ts
│     ├─ health.ts
│     ├─ package.json               # Dependencias locales mínimas (solo @prisma/client + AWS SDK)
│     └─ _shared/
│        ├─ response.ts
│        ├─ prisma.ts
│        ├─ pipedrive.ts
│        └─ mappers.ts
│
├─ prisma/
│  └─ schema.prisma                 # Esquema de BD (Neon u otro Postgres)
│
├─ netlify.toml                     # Build y Functions (config final optimizada)
├─ package.json                     # Scripts raíz (generate/build)
└─ README.md


🔹 Las dependencias de ejecución de las Functions se aíslan en
backend/functions/package.json, lo que reduce drásticamente el tamaño de cada función (<50 MB).
🔹 Netlify empaqueta con esbuild y usa Prisma con Node-API (library engine).

⚙️ Requisitos

Node.js ≥ 22

npm ≥ 10.8.0

🔑 Variables de entorno

Defínelas en Netlify y en local (.env):

Base de datos

DATABASE_URL → cadena de conexión Postgres (Neon u otro)

Pipedrive

PIPEDRIVE_API_TOKEN

PIPEDRIVE_BASE_URL (opcional, por defecto https://api.pipedrive.com/v1
)

S3 (documentos)

S3_BUCKET

S3_REGION

S3_ACCESS_KEY_ID

S3_SECRET_ACCESS_KEY

🖥️ Desarrollo local

Instalar dependencias

npm install
cd frontend && npm install && cd ..


Prisma se genera en postinstall. Si necesitas forzarlo:

npx prisma generate --schema=prisma/schema.prisma


Levantar frontend (Vite)

cd frontend
npm run dev
# http://localhost:5173


Opcional – Functions en local con Netlify CLI

npx netlify dev -p 8888
# expone frontend y /.netlify/functions/*

🏗️ Build y despliegue (Netlify)
netlify.toml (resumen actual)
[build]
  command = "npm run netlify:build"
  publish = "frontend/dist"

[build.environment]
  NODE_VERSION = "22"

[functions]
  directory = "backend/functions"
  node_bundler = "esbuild"
  included_files = [
    "node_modules/.prisma/client/libquery_engine-*.node",
    "node_modules/.prisma/client/libquery_engine-*.so.node",
    "node_modules/.prisma/client/schema.prisma"
  ]


🔹 Se eliminó external_node_modules para permitir que Netlify use
el package.json local de backend/functions.
🔹 Prisma se genera con engineType = "library" y binaryTargets = ["native","rhel-openssl-3.0.x"].

Scripts relevantes (package.json raíz)
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

🔌 Endpoints principales

Salud

GET /.netlify/functions/health → { ok: true, ts }


Presupuestos

GET /.netlify/functions/deals?noSessions=true
GET /.netlify/functions/deals?dealId=7222
POST /.netlify/functions/deals/import
PATCH /.netlify/functions/deals/:dealId


Documentos (S3)

POST /.netlify/functions/deal_documents/:dealId/upload-url
POST /.netlify/functions/deal_documents/:dealId
GET  /.netlify/functions/deal_documents/:dealId/:docId/url
DELETE /.netlify/functions/deal_documents/:dealId/:docId

🛠️ Desarrollo Backend / Prisma
npx prisma generate --schema=prisma/schema.prisma
npx tsc -p backend/tsconfig.json --noEmit

🔁 Flujo de trabajo (Git)
git checkout -b fix/issue
git add -A
git commit -m "fix: descripción clara"
git push -u origin fix/issue
gh pr create --fill --web

🗺️ Roadmap breve

Webhook Pipedrive → import automático.

Migración deal_products → hours + comments.

deal_files → añadir origin.

Filtros por tipo y categoría.

Planificador visual de sesiones.

Tests E2E (importación y edición).

📎 Notas técnicas

Serialización BigInt: conversión a string en _shared/response.ts.

Prisma Node-API: usa libquery_engine-*.node (más ligero y compatible).

Dependencias functions: aisladas en backend/functions/package.json para evitar superar el límite de 250 MB.