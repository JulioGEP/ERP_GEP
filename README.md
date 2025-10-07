# ERP_GEP

ERP interno colaborativo para planificar, visualizar y gestionar formaciones de GEP Group, sincronizado con Pipedrive y desplegado en Netlify.

## 🚀 Visión

La aplicación permite:

- Importar y normalizar datos desde Pipedrive (deals, organizaciones, personas, productos, notas y ficheros).
- Planificar y editar la información clave de **Presupuestos** (deals) con campos operativos propios.
- Visualizar listados y detalle en el frontend (React + Vite).
- Exponer una **API interna** mediante **Netlify Functions** (Node 22 + esbuild).
- Gestionar documentos de cada deal mediante S3 (subida con URL firmada y metadatos en BD).

---

## 🧱 Stack y arquitectura

- **Frontend**: React + Vite + TypeScript (build estático en `frontend/dist`).
- **Backend**: Netlify Functions (Node 22, empaquetadas con esbuild).
- **ORM/DB**: Prisma (PostgreSQL en Neon). Cliente Prisma generado en el monorepo.
- **Integración**: API Pipedrive v1 (fetch nativo con utilidades y caché en memoria por invocación).
- **Almacenamiento docs**: S3 (presigned URLs) con metadatos en tabla `deal_files`.
- **Infra Netlify**: `netlify.toml` (build y funciones), `backend.toml` (legacy; prevalece `netlify.toml`).

Estructura relevante:
ERP_GEP-main/
├─ frontend/ # App React (Vite + TS)
│ ├─ src/
│ │ ├─ features/presupuestos/
│ │ │ ├─ BudgetTable.tsx
│ │ │ ├─ BudgetDetailModal.tsx
│ │ │ ├─ BudgetImportModal.tsx
│ │ │ └─ api.ts # Cliente hacia /.netlify/functions/*
│ │ ├─ types/deal.ts # Modelos de vista y tipos normalizados
│ │ ├─ App.tsx
│ │ ├─ main.tsx
│ │ └─ styles.css
│ ├─ package.json
│ └─ ...
├─ backend/
│ └─ functions/ # Netlify Functions
│ ├─ deals.ts # Listado, detalle, importación y PATCH de deals
│ ├─ deal_documents.ts # Gestión de documentos (S3 + metadatos)
│ ├─ health.ts # Healthcheck
│ ├─ _shared/
│ │ ├─ env.ts # requireEnv
│ │ ├─ mappers.ts # Upsert + mapeos a BD desde Pipedrive
│ │ ├─ pipedrive.ts # Cliente Pipedrive + utilidades
│ │ ├─ prisma.ts # getPrisma (cliente)
│ │ └─ response.ts # Respuestas JSON + CORS + BigInt-safe
│ ├─ _lib/
│ │ ├─ db.ts # helpers DB (si aplica)
│ │ └─ http.ts # headers/JSON (legacy)
│ └─ package.json # deps locales de functions (@prisma/client + AWS SDK)
├─ prisma/
│ └─ schema.prisma # Modelos: organizations, persons, deals, deal_products, deal_files, ...
├─ netlify.toml # Build y runtime (Node 22) + redirects API
├─ backend.toml # (No prevalece si existe netlify.toml)
├─ package.json # Scripts monorepo (generate, netlify:build, etc.)
├─ tsconfig.json
└─ .env # Variables locales (no commitear)

perl
Copiar código

> **Nota**: `netlify.toml` fija **Node 22** para Functions y define los redirects `/api/*` → `/.netlify/functions/:splat`. Es la referencia **canónica** de build y runtime.

---

## 🔑 Variables de entorno

Crea `.env` en la raíz (nunca versionar) con:

**Base de datos / CORS**
- `DATABASE_URL` → cadena PostgreSQL (Neon).
- `CORS_ORIGIN` → origen permitido para el frontend (p.ej. `http://localhost:8888` o tu dominio).

**Pipedrive**
- `PIPEDRIVE_API_TOKEN` → token API.
- `PIPEDRIVE_BASE_URL` → opcional (por defecto `https://api.pipedrive.com/v1`).

**Campos de producto (catálogo)**
- `PD_PRODUCT_HOURS_KEY` → nombre clave del campo “hours” en producto (por defecto `hours`).
- `PD_PRODUCT_TYPE_KEY`  → clave del “type” en producto     (por defecto `type`).
- `PD_PRODUCT_CATEGORY_KEY` → clave categoría si aplica       (por defecto `category`).

> En `_shared/pipedrive.ts` existen **hash/keys de fallback** para horas/tipo de producto; si tu instancia difiere, sobreescribe por ENV.

**S3 (documentos)**
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

> Si faltan credenciales S3, `deal_documents` funciona parcialmente (listado/BD) pero no podrá firmar subidas/descargas.

---

## 🗄️ Esquema de datos (resumen útil)

> Ver `prisma/schema.prisma` para el detalle. Puntos clave utilizados por el frontend:

- `deals`  
  Campos operativos usados por UI/API:  
  `alumnos` (Int), `training_address` (String?), `sede_label` (String?), `caes_label` (String?), `fundae_label` (String?), `hotel_label` (String?), `title`, `org_id`, `pipeline_id`, timestamps.

- `deal_products`  
  `quantity` (Decimal→number), `price` (Decimal→number), `type` (enum `TRAINING|EXTRA`), y soporte para `hours`/`comments`/`typeLabel` en la capa de **normalización** del frontend.

- `deal_files`  
  Listado de ficheros por deal. Si `file_url` no es HTTP, se interpreta como **S3 key** (para borrar el objeto en `DELETE`).

---

## 🔁 Mapeo Pipedrive → BD → API

En `_shared/mappers.ts` y `_shared/pipedrive.ts`:

- **Campos “opción única” del deal**:  
  `sede`, `caes`, `fundae`, `hotel` se resuelven a **label** con `optionLabelOf(...)`. El valor persistido en BD y expuesto por API es el **texto** (no el ID numérico).  
  → El frontend recibe `sedeLabel`, `caesLabel`, `fundaeLabel`, `hotelLabel`.

- **Campo de dirección del deal** (`training_address`):  
  Se construye a partir de la clave base real de PD (`KEY_TRAINING_ADDRESS_BASE` + sufijos). El valor llega como **string** human-readable (no objeto complejo) y se guarda en `deals.training_address`.

- **Productos del deal**:  
  Se enriquece cada línea con `hoursNumber`, `type`, `category` a partir de campos de producto (catálogo) o de la línea si existiera un custom por línea (fallback `KEY_PRODUCT_HOURS_IN_LINE`).  
  En el frontend se expone como `products[]` listos para UI (números limpios, labels resueltos).

> **Importante**: las **KEYS reales** de Pipedrive están codificadas en `mappers.ts` como constantes (p.ej. `KEY_SEDE`, `KEY_CAES`, `KEY_FUNDAE`, `KEY_HOTEL`, `KEY_TRAINING_ADDRESS_BASE`). Si cambian en tu instancia, actualízalas en código o implementa su lectura dinámica.

---

## 📡 API (Netlify Functions)

Prefijo base en producción: `/.netlify/functions/*`  
En local con Netlify CLI: `http://localhost:8888/.netlify/functions/*`

### Health
`GET /health` → `{ ok: true, ts }`

### Deals
- `GET /deals?noSessions=true`  
  Devuelve **listado** de deals en orden `created_at desc` ya normalizados para tabla (BudgetTable).

- `GET /deals/:dealId`  
  Devuelve **detalle** enriquecido: organización, persona, productos normalizados, notas y ficheros.

- `PATCH /deals/:dealId`  
  **Campos editables** (validados en backend):  
  `sede_label`, `caes_label`, `fundae_label`, `hotel_label`, `training_address`, `alumnos`  
  (más otros alias de entrada soportados por compatibilidad en `deals.ts`, p.ej. `training_address_label` si llega desde UI antigua).  
  Cualquier campo fuera de este set se rechaza con error.

- **Importación/actualización**  
  La importación desde Pipedrive se resuelve dentro de `/deals` según método/ruta definidos en `deals.ts`.  
  El backend:
  1) consulta deal, org, person, products, notes, files en Pipedrive  
  2) hace **upsert** de todo el árbol en BD  
  3) responde con el deal normalizado

### Documentos del deal
Rutas en `deal_documents.ts` (con o sin el prefijo `/.netlify/functions`):

1) `POST /deal_documents/:dealId/upload-url`  
   → `{ uploadUrl, storageKey }` (URL firmada S3). Subir binario con `PUT` a `uploadUrl`.

2) `POST /deal_documents/:dealId`  
   Guarda metadatos en `deal_files` (usa `storageKey` si viene de S3; o `file_url` http si externo).

3) `GET /deal_documents/:dealId`  
   Lista documentos del deal (origen mixto).

4) `GET /deal_documents/:dealId/download/:docId`  
   Devuelve URL firmada de descarga si `file_url` es S3 key; si es http, redirige a `file_url`.

5) `DELETE /deal_documents/:dealId/:docId`  
   Elimina metadatos y, si procede, el objeto de S3.

> Si `S3_*` no están definidos, la firma de subidas/descargas no estará disponible; el resto de operaciones siguen operativas.

---

## 🖥️ Frontend (Presupuestos)

Componentes en `frontend/src/features/presupuestos/`:

- **BudgetTable**: tabla de deals (usa `GET /deals?noSessions=true`).
- **BudgetDetailModal**: detalle de deal con edición de campos operativos (usa `GET/PATCH /deals/:dealId` y listado de `products`, `notes`, `documents`).
- **BudgetImportModal**: flujo de importación desde Pipedrive (invoca endpoints del backend).

`frontend/src/features/presupuestos/api.ts` contiene la **normalización** de datos de API → UI:
- Convierte decimales a `number`, resuelve `sedeLabel`, `caesLabel`, `fundaeLabel`, `hotelLabel`.
- Asegura `training_address` como string limpio.
- Agrega `products` con `hours`, `typeLabel`, `category` listos para filtros/visualización.

---

## ⚙️ Desarrollo local

**Requisitos**:
- Node ≥ 20.18 (Frontend). Netlify Functions usan Node **22** según `netlify.toml`.
- NPM ≥ 10.8
- Netlify CLI para entorno local unificado (recomendado): `npm i -g netlify-cli`

**Pasos**:

1) Instala dependencias y genera Prisma
```bash
npm install
npm run generate   # prisma generate (usa schema.prisma)
Inicia el entorno local con Netlify (sirve frontend y functions con redirects)

bash
Copiar código
npx netlify dev -p 8888
# Frontend: http://localhost:8888
# Functions: http://localhost:8888/.netlify/functions/health
Si no usas Netlify CLI, puedes levantar el frontend con cd frontend && npm run dev, pero las Functions no estarán proxied en el mismo puerto.

Scripts útiles (raíz):

npm run netlify:build → prisma generate + build frontend (lo que se ejecuta en Netlify).

npm run typecheck:functions → typecheck de Functions.

npm run db:init → script opcional de inicialización si lo necesitas (requiere .env).

🚀 Build y despliegue
Netlify usa netlify.toml:

Build: npm run netlify:build
(genera Prisma y build del frontend)

Publish: frontend/dist

Functions: backend/functions (Node 22, esbuild)

Redirects:

/api/* → /.netlify/functions/:splat

/* → /index.html (SPA)

Para Prisma, se incluyen binarios en included_files para evitar problemas en Functions.

🧩 Convenciones de datos (UI/Back)
Alias/campos vigentes (obligatorio respetar):

sede_label, caes_label, fundae_label, hotel_label

training_address

alumnos

El backend acepta PATCH solo de estos campos (y alias temporales de entrada documentados en deals.ts). Cualquier otro campo se rechaza.

Normalizaciones clave:

ID numéricos de Pipedrive en campos de opción única → se convierten a label (texto legible).

Dirección compuesta de Pipedrive → string (training_address).

Decimales de BD → number en API (serializador BigInt-safe en response.ts).

✅ Checklist de verificación antes de PR
.env completo (DATABASE_URL, PIPEDRIVE_API_TOKEN, CORS_ORIGIN, S3_* si aplica).

npm run generate sin errores.

npx netlify dev -p 8888 arranca y GET /.netlify/functions/health responde { ok: true }.

Frontend carga y BudgetTable lista deals.

Detalle de deal abre, permite PATCH de campos y refleja cambios.

Subida de documentos:

POST upload-url entrega uploadUrl.

PUT a uploadUrl funciona y POST metadatos persiste.

GET download/:docId devuelve URL firmada si es S3 key.

Logs sin errores (especialmente de Prisma y CORS).

🔍 Troubleshooting rápido
CORS bloqueado → revisa CORS_ORIGIN (múltiples orígenes no soportados a la vez; usa * solo en local).

Prisma en Functions → asegúrate de que Netlify incluye los binarios (included_files de netlify.toml) y que @prisma/client está en backend/functions/package.json.

Labels nulos en sede/caes/fundae/hotel → revisa que las KEYS reales en mappers.ts coincidan con tu instancia de Pipedrive.

training_address vacío → confirma KEY_TRAINING_ADDRESS_BASE y sufijos de address en PD.

Horas de producto → si no salen, configura PD_PRODUCT_HOURS_KEY o verifica el custom de línea (KEY_PRODUCT_HOURS_IN_LINE) en mappers.ts.

🧭 Flujo de trabajo (VS Code / Codespaces)
Trabaja en rama de feature/fix.

Verifica local con npx netlify dev -p 8888.

Commit + push + PR.

Merge cuando pase la checklist y esté validado en entorno previo si aplica.

Este README es la referencia viva del proyecto. Cualquier cambio en endpoints, mapeos Pipedrive o convención de campos debe reflejarse aquí inmediatamente.

bash
Copiar código

## 3) Smoke test local
```bash
npm install
npm run generate
npx netlify dev -p 8888 &
sleep 4
curl -s http://localhost:8888/.netlify/functions/health
# Debe devolver: {"ok":true,...}