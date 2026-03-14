# ERP GEP

ERP GEP es un **monorepo** con dos piezas principales:

- **Frontend**: panel interno en React (operativa diaria de equipos de formación).
- **Backend**: API en Netlify Functions (lógica de negocio, integraciones y datos).

> Este README está orientado a ser práctico: qué hay, dónde está y cómo arrancarlo rápido.

## Tabla de contenidos

- [1) Qué resuelve este ERP](#1-qué-resuelve-este-erp)
- [2) Stack técnico](#2-stack-técnico)
- [3) Estructura real del repositorio](#3-estructura-real-del-repositorio)
- [4) Módulos funcionales (backend + frontend)](#4-módulos-funcionales-backend--frontend)
- [5) Autenticación, roles y permisos](#5-autenticación-roles-y-permisos)
- [6) Modelo de datos (Prisma)](#6-modelo-de-datos-prisma)
- [7) Variables de entorno](#7-variables-de-entorno)
- [8) Puesta en marcha local](#8-puesta-en-marcha-local)
- [9) Comandos útiles](#9-comandos-útiles)
- [10) Flujo recomendado para cambios](#10-flujo-recomendado-para-cambios)
- [11) Despliegue en Netlify](#11-despliegue-en-netlify)
- [12) Mapa visual para memoria](#12-mapa-visual-para-memoria)
- [13) Memoria funcional redactada](#13-memoria-funcional-redactada)

## 1) Qué resuelve este ERP

El sistema centraliza la operación de GEP alrededor de:

- Gestión de **presupuestos/deals**.
- Planificación de **sesiones formativas** y asignación de recursos.
- Gestión de **recursos** (formadores, salas, unidades móviles, variantes de producto).
- **Portal público de alumnos** para altas/bajas/ediciones con enlace seguro.
- **Informes y certificados**, incluyendo soporte con OpenAI y catálogo WooCommerce.
- **Reporting interno** operativo y de control.

## 2) Stack técnico

- **Node.js + TypeScript** en todo el monorepo.
- **Frontend**: React 18, Vite, React Router, React Query, Bootstrap 5.
- **Backend**: Netlify Functions TypeScript.
- **Datos**: PostgreSQL + Prisma ORM.
- **Integraciones**: Pipedrive, AWS S3, Google Drive, OpenAI, WooCommerce.

## 3) Estructura real del repositorio

```text
ERP_GEP/
├── backend/
│   ├── functions/
│   │   ├── _lib/           # Bootstrap y utilidades de bajo nivel
│   │   ├── _shared/        # Helpers transversales (HTTP, auth, integraciones...)
│   │   ├── types/          # Tipos compartidos en funciones
│   │   └── *.ts            # Endpoints serverless
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── api/            # Cliente HTTP y adaptadores
│   │   ├── app/            # Router/layout
│   │   ├── features/       # Lógica por dominio
│   │   ├── pages/          # Pantallas por ruta
│   │   ├── public/         # Flujos públicos de alumnos
│   │   └── shared/         # Componentes/hooks utilitarios
│   └── package.json
├── prisma/
│   └── schema.prisma       # Modelo de datos único
├── scripts/                # Scripts de mantenimiento y SQL puntual
├── netlify.toml
├── backend.toml
└── README.md
```

## 4) Módulos funcionales (backend + frontend)

### 4.1 Presupuestos (deals)

- Backend principal: `backend/functions/deals.ts`, `deal_notes.ts`, `deal_documents.ts`.
- Frontend principal: `frontend/src/features/presupuestos`, `frontend/src/pages/presupuestos/*`.
- Función: sincronización/consulta de oportunidades, notas y documentos.

### 4.2 Calendario y planificación

- Backend: `sessions.ts`, `calendar-variants.ts`, `session_comments.ts`, `session_documents.ts`, `resources-confirmations.ts`.
- Frontend: `frontend/src/features/calendar`, `frontend/src/pages/calendario/*`.
- Función: planificación de sesiones, variantes, comentarios y documentos operativos.

### 4.3 Recursos

- Backend: `trainers.ts`, `rooms.ts`, `mobile-units.ts`, `products.ts`, `products-variants.ts`, `variant-siblings.ts`.
- Frontend: `frontend/src/pages/recursos/*`.
- Función: mantenimiento del catálogo de recursos y sus reglas/variantes.

### 4.4 Portal público de alumnos

- Backend: `public-session-students.ts`, `session_public_links.ts`, `alumnos.ts`.
- Frontend: `frontend/src/public/PublicSessionStudentsPage.tsx`.
- Función: gestión pública con token y limitación de peticiones.

### 4.5 Informes, certificados y panel de formadores

- Backend informes: `generateReport.ts`, `improveReport.ts`, `reportUpload.ts`, `reportPrefill.ts`.
- Backend formadores: `trainer-dashboard.ts`, `trainer-sessions.ts`, `trainer_documents.ts`, `trainer-availability.ts`.
- Frontend: `frontend/src/pages/informes/*`, `frontend/src/pages/certificados/*`, `frontend/src/pages/usuarios/trainer/*`.

### 4.6 Reporting

- Backend: `audit-events.ts`, `reporting-logs.ts`, `reporting-horas-formadores.ts`, `reporting-control-horario.ts`, `reporting-costes-extra.ts`.
- Frontend: `frontend/src/pages/reporting/*`, `frontend/src/pages/dashboard/*`.

## 5) Autenticación, roles y permisos

- Las rutas de autenticación están en endpoints `/auth-*` del backend.
- El frontend centraliza estado de sesión en `frontend/src/context/AuthContext.tsx`.
- La protección de rutas se aplica con guardas (`RequireAuth` / `GuardedRoute`).
- El sistema permite validación por permisos y patrones de ruta.

## 6) Modelo de datos (Prisma)

- El esquema está en `prisma/schema.prisma`.
- Áreas principales del modelo:
  - CRM: organizaciones, personas, deals, notas y ficheros.
  - Planificación: sesiones, recursos de sesión, comentarios, documentos.
  - Recursos: formadores, salas, unidades móviles, productos y variantes.
  - Portal público: tokens, enlaces públicos, alumnos de sesión.

### Prisma Client

Generar cliente cuando cambie el modelo:

```bash
npm run generate
```

## 7) Variables de entorno

Crear `.env` en la raíz del proyecto.

### Núcleo

- `DATABASE_URL`
- `ALLOWED_EMAIL_DOMAIN`
- `DEFAULT_NOTE_AUTHOR`

### Documentos

- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `GOOGLE_DRIVE_CLIENT_EMAIL`, `GOOGLE_DRIVE_PRIVATE_KEY`, `GOOGLE_DRIVE_SHARED_DRIVE_ID`, `GOOGLE_DRIVE_BASE_FOLDER_NAME`

### Integraciones

- `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_BASE_URL`
- `WOO_API_KEY`, `WOO_API_SECRET`, `WOO_BASE_URL`
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`

### Portal público y CORS de informes

- `PUBLIC_SESSION_RATE_LIMIT_WINDOW_MS`
- `PUBLIC_SESSION_RATE_LIMIT_MAX_REQUESTS`
- `REPORTS_ALLOWED_ORIGIN`

## 8) Puesta en marcha local

1. Instalar dependencias:
   ```bash
   npm install
   ```
2. Generar Prisma Client:
   ```bash
   npm run generate
   ```
3. Levantar frontend + funciones con Netlify:
   ```bash
   npx netlify dev -p 8888
   ```
4. Abrir:
   - App: `http://localhost:8888`
   - API (proxy): `http://localhost:8888/api/*`

> Opcional: ejecutar solo frontend

```bash
npm run dev --workspace frontend
```

## 9) Comandos útiles

Desde la raíz:

- `npm run build` — build de frontend.
- `npm run test --workspace frontend` — tests de interfaz.
- `npm run typecheck --workspace frontend` — types frontend.
- `npm run typecheck:functions` — types backend functions.
- `npm run prisma:format` — formato de esquema Prisma.
- `npm run prisma:prune` — limpieza de binarios Prisma para CI/Netlify.
- `npm run netlify:build` — pipeline de build de despliegue.

## 10) Flujo recomendado para cambios

1. Identificar módulo funcional (deals, calendario, recursos, etc.).
2. Cambiar backend (`backend/functions`) y validar contrato de API.
3. Ajustar frontend (`frontend/src/features` o `frontend/src/pages`).
4. Si hay cambios de datos, modificar `prisma/schema.prisma` + regenerar Prisma Client.
5. Ejecutar typecheck y tests mínimos antes de abrir PR.

## 11) Despliegue en Netlify

- Netlify ejecuta `npm run netlify:build`.
- `netlify.toml` define redirects (`/api/*` hacia funciones, auth y fallback SPA).
- `backend.toml` define build del workspace backend y empaquetado de dependencias necesarias.

---

Si vas a ampliar el ERP (nuevos módulos o endpoints), mantén este README alineado para que siga siendo útil como mapa operativo del proyecto.


## 12) Mapa visual para memoria

- Documento recomendado: `docs/mapa-funcionalidades-erp.md`.
- Incluye un **mindmap** y un **flujo operativo** en formato Mermaid, listos para copiar en una memoria funcional.


## 13) Memoria funcional redactada

- Documento completo: `docs/memoria-funcional-erp-gep.md`.
- Incluye secciones de **introducción, objetivos, alcance, metodología, conclusiones y anexos**.
