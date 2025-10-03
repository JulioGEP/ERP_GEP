ERP_GEP

ERP interno colaborativo para planificar, visualizar y gestionar formaciones de GEP Group, sincronizado con Pipedrive y desplegado en Netlify.

🚀 Visión

El objetivo es disponer de una aplicación web interna que:

Importe datos de Pipedrive (deals, organizaciones, personas).

Permita planificar sesiones de formación, recursos y presupuestos.

Visualice la información en tiempo real para varios usuarios.

Exponga una API interna en Netlify Functions.

📂 Estructura del monorepo
ERP_GEP/
├── frontend/                        # App React + Vite + TypeScript
│   ├── public/
│   │   └── _redirects               # (opcional) Alias /api/* → /.netlify/functions/:splat
│   ├── src/
│   │   └── features/presupuestos/
│   │       ├── BudgetTable.tsx
│   │       └── api.ts               # Cliente API → /.netlify/functions/*
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   ├── vite-env.d.ts
│   └── package.json
│
├── backend/
│   └── functions/                   # Netlify Functions (Node 20, esbuild)
│       ├── deals.ts                 # GET /deals?..., POST /deals/import, PATCH /deals/:id
│       ├── deal_documents.ts        # S3 presigned URLs
│       ├── health.ts                # GET /health
│       ├── _shared/
│       │   ├── response.ts          # ✅ JSON seguro (BigInt→string)
│       │   ├── prisma.ts
│       │   └── env.js
│       └── _lib/
│           ├── http.ts              # (utilidades HTTP; también con safe stringify)
│           └── db.ts
│
├── netlify.toml                     # Build + Functions (directory = "backend/functions")
├── prisma/                          # schema.prisma (si aplica)
├── package.json                     # Scripts raíz (generate/build)
└── README.md


Nota: Anteriormente la carpeta se llamaba netlify/. Ahora es backend/. El prefijo público de Functions siempre es /.netlify/functions/* (no depende del nombre de carpeta).

⚙️ Requisitos

Node.js >= 20.18.0 (usamos 20.19.x en CI)

npm >= 10.8.0

🔑 Variables de entorno (resumen)

Configúralas en Netlify y en local (.env) según corresponda:

DATABASE_URL → Postgres (Neon u otro)

PIPEDRIVE_API_TOKEN → token API Pipedrive

S3 (documentos):

AWS_REGION

AWS_S3_BUCKET

AWS_ACCESS_KEY_ID

AWS_SECRET_ACCESS_KEY

🖥️ Desarrollo local
1) Instalar dependencias (raíz y frontend)
npm install
cd frontend && npm install && cd ..


Prisma se genera automáticamente en postinstall. Si lo necesitas manual:

npx prisma generate

2) Ejecutar en local

Frontend (Vite):

cd frontend
npm run dev
# http://localhost:5173


(Opcional) Functions en local con Netlify CLI:

# requiere netlify-cli disponible via npx o global
npx netlify dev -p 8888
# Expone frontend y /.netlify/functions/*

🏗️ Build y despliegue (Netlify)

netlify.toml:

[build]
  command  = "npm run netlify:build"
  publish  = "frontend/dist"

[functions]
  directory = "backend/functions"


Scripts relevantes en package.json (raíz):

{
  "scripts": {
    "generate": "prisma generate",
    "postinstall": "prisma generate",
    "build:frontend": "cd frontend && npm install && npm run build",
    "build": "npm run build:frontend",
    "netlify:build": "npm run generate && npm run build"
  },
  "dependencies": {
    "@prisma/client": "^5.22.0",
    "@aws-sdk/client-s3": "^3.679.0",
    "@aws-sdk/s3-request-presigner": "^3.679.0"
  },
  "devDependencies": {
    "prisma": "^5.22.0",
    "typescript": "^5.9.3"
  }
}


Publicación:

Frontend → frontend/dist

API (Functions) → /.netlify/functions/*

Alias /api (opcional):
Si quieres usar /api/* como atajo, en frontend/public/_redirects:

/*    /index.html   200
/api/*  /.netlify/functions/:splat  200

🔌 Endpoints principales

GET /.netlify/functions/health → { ok: true, ts }

GET /.netlify/functions/deals?noSessions=true → { ok: true, deals: [...] }

GET /.netlify/functions/deals?dealId=7222 → { ok: true, deal: {...} }

POST /.netlify/functions/deals/import (JSON: { "dealId": "7222" }) → { ok: true, deal: { deal_id, ... } }

PATCH /.netlify/functions/deals/:dealId → actualiza campos editables (+comentarios)

Documentos (deal_documents.ts):

POST /.netlify/functions/deal_documents/:dealId/upload-url

GET /.netlify/functions/deal_documents/:dealId/:docId/url

POST /.netlify/functions/deal_documents/:dealId

DELETE /.netlify/functions/deal_documents/:dealId/:docId

🧪 Comprobaciones rápidas (desde terminal)
# Salud
curl -s https://<tu-sitio>.netlify.app/.netlify/functions/health | jq

# Listado para la tabla de Presupuestos
curl -s 'https://<tu-sitio>.netlify.app/.netlify/functions/deals?noSessions=true' | jq

# Detalle
curl -s 'https://<tu-sitio>.netlify.app/.netlify/functions/deals?dealId=7222' | jq

# Importación (backend OK si responde 200)
curl -s -X POST 'https://<tu-sitio>.netlify.app/.netlify/functions/deals/import' \
  -H 'Content-Type: application/json' --data '{"dealId":"7222"}' | jq


Si configuras _redirects, podrás usar el alias /api/* (tras deploy):
POST https://<tu-sitio>.netlify.app/api/deals/import

🧩 UI/Frontend (estado)

Tabla de Presupuestos:

Consume /.netlify/functions/deals?noSessions=true.

Render robusto: no descarta filas si faltan organization o productNames.

Fallback de respaldo: si el prop llega vacío pero el backend tiene datos, hace un fetch directo y pinta.

Importación de deals:

Cliente importDeal() en frontend/src/features/presupuestos/api.ts.

Ruta correcta: /.netlify/functions/deals/import.
(Se eliminó el antiguo deals_import que provocaba HTTP_404).

Detalle de deal:

Usa GET /.netlify/functions/deals?dealId=<id> (por query string).

✅ Cambios técnicos recientes

Fix BigInt JSON: serialización segura en respuestas de Functions (_shared/response.ts y helpers HTTP)
→ evita Do not know how to serialize a BigInt.

Arreglo importación: frontend y redirects apuntan a deals/import (no deals_import).

Prisma:

@prisma/client en dependencias de raíz.

postinstall ejecuta prisma generate.

AWS SDK v3 agregado para presigned URLs de documentos.

TypeScript: cast explícito del JSON de Pipedrive en deals.ts para evitar warnings de json.data.

🧰 Contribución / Flujo de trabajo

Trabaja en Codespaces (ramas sobre main o PRs según convenga).

Revisa cambios:

git status
git diff --staged --name-only


Sube TODO lo pendiente:

git add -A
git commit -m "feat/fix: descripción"
git push origin main


Netlify dispara deploy automático.
Verifica con los curl de arriba y en la UI.

🗺️ Roadmap corto

Sincronización incremental con Pipedrive (webhooks / polling).

Planificador visual de sesiones por presupuesto.

Historial de cambios y actividad.

Tests E2E básicos (importación y edición de 7 campos).