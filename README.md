# ERP GEP Monorepo

Plataforma interna para la gestión operativa de presupuestos y formaciones. El proyecto se organiza como un monorepo con un frontend en Vite/React y un backend basado en Netlify Functions que expone una API sobre una base de datos PostgreSQL alojada en Neon.

## 🧱 Arquitectura general

| Capa | Tecnología principal | Descripción |
| --- | --- | --- |
| Frontend | Vite + React + TypeScript | Panel operativo para visualizar y actualizar deals, notas, documentos y recursos logísticos. |
| Backend | Netlify Functions (TypeScript) | Endpoints serverless desplegados en Netlify para sincronización con Pipedrive, carga de documentos y gestión de catálogos. |
| Base de datos | PostgreSQL (Neon) + Prisma ORM | Modelado de deals, organizaciones, sesiones y entidades relacionadas. |
| Almacenamiento de archivos | AWS S3 | Gestión de documentos vinculados a cada deal mediante URLs firmadas. |

El repositorio está preparado para desplegarse automáticamente en Netlify, que ejecuta las funciones backend y sirve el frontend compilado.

## 📂 Estructura del repositorio

```
├── backend/            # Netlify Functions escritas en TypeScript
│   ├── functions/      # Endpoints agrupados por dominio (deals, documentos, trainers...)
│   └── tsconfig.json   # Configuración de compilación para las funciones
├── frontend/           # Aplicación Vite + React
│   ├── src/            # Componentes, hooks y utilidades del panel
│   └── vite.config.ts  # Configuración de build y dev server
├── prisma/             # Esquema Prisma y definiciones del modelo de datos
├── scripts/            # Scripts auxiliares (ej. inicialización de la BD)
├── backend.toml        # Configuración de Netlify Functions
├── netlify.toml        # Configuración del despliegue en Netlify
└── package.json        # Scripts y dependencias comunes del monorepo
```

## 📦 Requisitos previos

- Node.js >= 22.0.0
- npm >= 10.8.0
- Acceso a variables de entorno con credenciales de Neon, AWS y Pipedrive
- Netlify CLI (opcional) para ejecutar `netlify dev`

## ⚙️ Puesta en marcha local

1. **Instalación de dependencias**
   ```bash
   npm install
   ```
2. **Generar Prisma Client** (se ejecuta automáticamente tras `npm install`, pero se puede forzar):
   ```bash
   npm run generate
   ```
3. **Inicializar datos básicos** (requiere `.env`):
   ```bash
   npm run db:init
   ```
4. **Ejecutar en local**:
   - Backend + Frontend con Netlify CLI (puerto 8888):
     ```bash
     npx netlify dev -p 8888
     ```
   - Solo frontend (dentro de `frontend/`):
     ```bash
     npm install
     npm run dev
     ```

## 🔐 Variables de entorno

Crear un archivo `.env` en la raíz con las siguientes claves mínimas:

- `DATABASE_URL` — Cadena de conexión a Neon (PostgreSQL).
- `ALLOWED_EMAIL_DOMAIN` — Dominio autorizado para iniciar sesión.
- `DEFAULT_NOTE_AUTHOR` — Autor por defecto para notas importadas (opcional, por defecto `erp_user`).
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — Credenciales de AWS S3 para documentos.
- Credenciales/keys necesarias para integrarse con la API de Pipedrive (no versionadas).

> 🔒 **No** versionar archivos `.env` ni credenciales.

## 🗄️ Modelo de datos

Las entidades principales gestionadas en la base de datos son:

- `organizations`, `persons` — Catálogo de clientes y contactos asociados.
- `deals` — Presupuestos y formaciones vinculadas a organizaciones y personas.
- `deal_products`, `deal_notes`, `deal_files` — Productos, notas y documentos asociados a cada deal.
- `trainers`, `rooms`, `mobile_units` — Recursos logísticos gestionados desde el backend.

### Convenciones de campos importados desde Pipedrive

| Campo original | Alias en ERP | Descripción |
| --- | --- | --- |
| `deal_org_id` | `org_id` | Identificador de la organización |
| `deal_direction` | `training_address` | Dirección de la formación |
| `Sede` | `sede_label` | Sede operativa |
| `CAES` | `caes_label` | Marca si el centro es CAES |
| `FUNDAE` | `fundae_label` | Indica si tiene bonificación FUNDAE |
| `Hotel_Night` | `hotel_label` | Necesidad de alojamiento |
| `deal_files` | `documents[]` | Documentos vinculados al deal |

## 🔗 Integraciones externas

### Pipedrive API v1
- Sincronización bidireccional de deals, organizaciones y personas.
- Hook de importación en tiempo real mediante Netlify Function `POST /deals/import`.
- Normalización de campos previa a la inserción en la base de datos.

### AWS S3
- Subida de documentos con URLs firmadas (`POST /deal_documents`).
- Metadatos persistidos en la tabla `deal_files` (`file_name`, `file_url`, `storage_key`).

## 🌐 Endpoints disponibles

| Endpoint | Método | Descripción |
| --- | --- | --- |
| `/deals/import` | `POST` | Importación de deals desde Pipedrive |
| `/deals?noSessions=true` | `GET` | Listado de deals sin sesiones planificadas |
| `/deals/:dealId` | `GET` | Detalle de un deal específico |
| `/deals/:dealId` | `PATCH` | Actualización de campos operativos (sede, horas, alumnos, etc.) |
| `/deal_documents` | `POST` | Solicita URL firmada para subida de documentos |
| `/deal_notes` | `POST` | Inserta o actualiza notas vinculadas al deal |
| `/trainers`, `/rooms`, `/mobile-units` | `GET` | Catálogos de recursos operativos |
| `/health` | `GET` | Healthcheck de Netlify Functions |

## 👥 Autenticación y control de acceso

- Acceso restringido mediante la variable `ALLOWED_EMAIL_DOMAIN`.
- Inicio de sesión actual mediante email/contraseña. Se contempla evolución a magic link o SSO.

## 🚀 Despliegue

- Netlify ejecuta `npm run netlify:build`, que genera Prisma Client y compila el frontend.
- Las funciones se empaquetan automáticamente. `backend.toml` define rutas y timeouts personalizados.
- Para desplegar manualmente:
  ```bash
  netlify deploy
  ```

## 🛠️ Estándares de desarrollo

- Commits con [Conventional Commits](https://www.conventionalcommits.org/).
- Branches con prefijo `feature/*` o `fix/*`.
- Linter: ESLint + Prettier (configurado dentro del frontend).
- Documentación viva mantenida en este `README.md`.
- No se versionan artefactos de entorno ni credenciales.

## 🧭 Próximos pasos

- Sincronización completa de documentos desde Pipedrive.
- Previsualización de documentos sin necesidad de login en Pipedrive.
- Subida directa de archivos desde el popup del deal (persistiendo `file_name` y `storage_key`).
- Panel de sesiones vinculadas a cada presupuesto.
- Integración de WebSockets/SSE para actualizaciones en vivo.
- Dashboard de control de cargas y KPI.

---

¿Tienes dudas? Consulta las funciones en `backend/functions/` o el esquema Prisma para entender los campos disponibles.
