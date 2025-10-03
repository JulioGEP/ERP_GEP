README.md
# ERP_GEP

ERP interno colaborativo para **planificar, visualizar y gestionar formaciones** de GEP Group, sincronizado con Pipedrive y desplegado en Netlify.

## 🚀 Visión
El objetivo es disponer de una aplicación web interna que:
- Importe datos de **Pipedrive** (deals, organizaciones, personas).
- Permita planificar sesiones de formación, recursos y presupuestos.
- Visualice la información en tiempo real para varios usuarios.
- Exponga una API interna en Netlify Functions (`/api/*`).

---

## 📂 Estructura del monorepo



ERP_GEP/
├── frontend/ # App React + Vite + TypeScript
│ ├── src/ # Código de la aplicación
│ ├── tsconfig.json # Configuración TS del frontend
│ ├── tsconfig.node.json # Configuración TS para vite.config.ts
│ ├── vite-env.d.ts # Tipos de Vite
│ └── package.json
│
├── backend/
│ ├── functions/ # Netlify Functions (API /api/*)
│ │ ├── deals_import.ts
│ │ ├── health.ts
│ │ └── ...
│ ├── tsconfig.json # Configuración TS para funciones
│ └── package.json
│
├── netlify.toml # Configuración de build + redirects API
├── package.json # Scripts raíz (delegan en frontend/ y backend/)
└── README.md


---

## ⚙️ Requisitos

- Node.js `>=20.18.0`
- npm `>=10.8.0`
- Prisma CLI (si usas Neon DB)

---

## 🖥️ Desarrollo local

### 1. Instalar dependencias
En Codespaces o local:

```bash
# Frontend
npm install --prefix frontend

# Backend Functions
npm install --prefix backend/functions

2. Ejecutar el frontend
cd frontend
npm run dev


Abrir en: http://localhost:5173

3. Ejecutar funciones

Con Netlify CLI:

netlify dev


Esto levanta el frontend y funciones /api/* en paralelo.

🏗️ Build y despliegue
Comando de build en Netlify

Definido en netlify.toml:

[build]
  command = "npm run netlify:build"
  publish = "frontend/dist"
  functions = "backend/functions"


Ese script hace:

npm ci --prefix frontend && npm --prefix frontend run build

Despliegue

Netlify publica:

Frontend: en frontend/dist

API: en /.netlify/functions/*

Redirects configurados:

/api/diag → diag.ts

/api/health → health.ts

/api/deals/import → deals_import.ts

/api/* → catch-all de funciones

/* → index.html (SPA fallback)

📦 Scripts raíz
"scripts": {
  "build": "npm --prefix frontend run build",
  "netlify:build": "npm ci --prefix frontend && npm --prefix frontend run build",
  "postinstall": "npm ci --prefix frontend && npm ci --prefix backend/functions || true",
  "typecheck:functions": "npm --prefix backend/functions run typecheck || true",
  "build:functions": "npm --prefix backend/functions run build || true"
}

🛠️ Tecnologías clave

Frontend: React 18, React-Bootstrap, React Query, Vite 5, TypeScript.

Backend Functions: Netlify Functions (Node 20, esbuild).

ORM: Prisma + Neon (Postgres serverless).

Infraestructura: Netlify (builds, API serverless, deploy).

🔑 Notas de desarrollo

Usa siempre la versión de TypeScript del proyecto (no la global):

// .vscode/settings.json
{
  "typescript.tsdk": "frontend/node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}


Para regenerar lockfiles limpios:

rm -f package-lock.json
npm install
npm install --prefix frontend
npm install --prefix backend/functions


Los tipos vite/client y node están declarados en cada tsconfig.

Netlify transpila automáticamente las funciones TS con esbuild.

✅ Estado actual

🔹 Frontend: compilando correctamente con TS + Vite.

🔹 Backend: funciones organizadas y tipadas.

🔹 Deploy: corregido error backend-cli (ya no existe en locks).

🔹 Pendiente: integrar datos reales de Pipedrive vía API/SDK.


---
