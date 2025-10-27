# ERP GEP Monorepo

Plataforma interna para gestionar presupuestos, planificación de formaciones y recursos logísticos del grupo GEP. El repositorio agrupa un frontend en Vite/React y un backend de funciones serverless desplegadas en Netlify que comparten el mismo esquema de datos en PostgreSQL gestionado con Prisma.

## Tabla de contenidos
- [Visión general](#visión-general)
- [Tecnologías principales](#tecnologías-principales)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Backend: funciones y librerías compartidas](#backend-funciones-y-librerías-compartidas)
- [Frontend: organización y flujo de la aplicación](#frontend-organización-y-flujo-de-la-aplicación)
- [Datos y Prisma](#datos-y-prisma)
- [Integraciones externas](#integraciones-externas)
- [Requisitos y configuración de entorno](#requisitos-y-configuración-de-entorno)
- [Puesta en marcha local](#puesta-en-marcha-local)
- [Scripts útiles](#scripts-útiles)
- [Testing y calidad](#testing-y-calidad)
- [Despliegue](#despliegue)
- [Onboarding y próximos pasos recomendados](#onboarding-y-próximos-pasos-recomendados)

## Visión general
- **Monorepo**: frontend React (panel interno) + backend de funciones Netlify que sirven la API REST y tareas batch bajo demanda.
- **Sincronización operativa**: los endpoints clave integran datos con Pipedrive, gestionan documentos en Google Drive/AWS S3 y orquestan reportes.
- **Base de datos única**: Prisma modela deals, sesiones, alumnos, recursos y catálogos; ambos lados del monorepo consumen los mismos modelos.
- **Flujo de despliegue**: Netlify ejecuta la compilación completa (`npm run netlify:build`), genera Prisma Client y sirve el frontend y las funciones serverless.

## Tecnologías principales
| Capa | Tecnologías | Uso
| --- | --- | --- |
| Frontend | Vite, React 18, React Router v7, React Query v5, React-Bootstrap | UI operativa, navegación SPA y consumo de la API.
| Backend | Netlify Functions (TypeScript) | Endpoints REST para deals, calendarios, recursos, documentos y reportes.
| Datos | PostgreSQL (Neon) + Prisma ORM | Modelado de entidades y generación de cliente tipado.
| Almacenamiento de ficheros | AWS S3 + Google Drive | Subida/descarga de documentos y sincronización con carpetas compartidas.
| Integraciones | Pipedrive API, OpenAI API | Sincronización CRM y generación automática de informes.

## Estructura del repositorio
```
├── backend/
│   ├── functions/           # Funciones Netlify agrupadas por dominio
│   │   ├── _shared/         # Utilidades reutilizadas (Prisma, respuestas HTTP, mapeos…)
│   │   ├── _lib/            # Inicialización de Prisma y helpers de bajo nivel
│   │   ├── deals.ts         # CRUD y sincronización de deals con Pipedrive
│   │   ├── deal_documents.ts# Gestión de documentos (S3, Google Drive, Pipedrive)
│   │   ├── sessions.ts      # Gestión de sesiones y calendario
│   │   ├── trainers.ts      # Catálogo de formadores
│   │   ├── public-session-students.ts
│   │   │                     # Portal público de alumnos con tokens y rate limiting
│   │   ├── generateReport.ts# Generación de informes (OpenAI)
│   │   └── ...              # Otros endpoints: notas, recursos, plantillas, etc.
│   └── tsconfig.json        # Configuración TypeScript del backend
├── frontend/
│   ├── src/
│   │   ├── App.tsx          # Layout global, navegación y modales de presupuestos
│   │   ├── app/router.tsx   # Router principal con carga diferida de vistas
│   │   ├── api/             # Cliente HTTP y wrappers de la API
│   │   ├── features/        # Lógica de dominios (presupuestos, calendario…)
│   │   ├── pages/           # Vistas de navegación
│   │   └── public/          # Flujos públicos (gestión de alumnos)
│   └── package.json         # Scripts y dependencias específicas del frontend
├── prisma/
│   ├── schema.prisma        # Modelo de datos y migraciones
│   └── seeds/               # (si aplica) semillas de datos
├── scripts/
│   ├── prisma-prune-binaries.mjs # Limpieza de binarios Prisma en CI/Netlify
│   └── fix_trainer_uniques.sql   # SQL auxiliar para corregir datos
├── backend.toml             # Configuración de funciones Netlify
├── netlify.toml             # Configuración de build/despliegue
├── package.json             # Scripts raíz y dependencias compartidas (@prisma/client, AWS SDK…)
└── tsconfig.json            # Configuración TypeScript común
```

## Backend: funciones y librerías compartidas
### Endpoints destacados
- **`deals.ts`**: sincroniza deals con Pipedrive, controla los campos editables y normaliza productos (`deal_products`), notas y documentos antes de exponerlos al frontend.
- **`deal_notes.ts`**: CRUD de notas de cada deal, respetando cabeceras `X-User-*` para auditar autores.
- **`deal_documents.ts`**: centraliza la gestión de documentos (petición de URL firmada, subida manual, listado, descarga proxy desde Pipedrive o S3 y sincronización opcional con Google Drive).
- **`sessions.ts` y `calendar-variants.ts`**: exponen la planificación de sesiones, permiten actualizar atributos operativos y agrupar la vista de calendario por recurso.
- **`public-session-students.ts`**: API pública protegida por tokens y rate limiting para gestionar alumnos sin autenticación interna (alta/baja/edición, auditoría de IP y user-agent).
- **`trainers.ts`, `rooms.ts`, `mobile-units.ts`, `products.ts`, `variant-*`**: catálogos maestros utilizados en el panel de recursos y en el calendario.
- **`generateReport.ts`, `improveReport.ts`, `reportUpload.ts`, `reportPrefill.ts`**: generación y enriquecimiento de informes en distintos formatos apoyados en OpenAI y plantillas PDF.
- **`woo_courses.ts` y `training-templates.ts`**: sincronizan catálogos externos (WooCommerce) y plantillas de certificados.
- **`health.ts`**: endpoint de healthcheck utilizado por Netlify y monitorización.

### Librerías comunes (`backend/functions/_shared` y `_lib`)
- **`prisma.ts` / `_lib/db.ts`**: inicialización singleton de Prisma Client con control de logs y fijación de la zona horaria de Madrid.
- **`response.ts`**: fabrica respuestas consistentes (JSON + cabeceras CORS), reutilizado en todas las funciones.
- **`pipedrive.ts`**: cliente ligero para consultar deals, notas, documentos y entidades relacionadas en Pipedrive.
- **`mappers.ts` y `dealPayload.ts`**: normalización de árboles de deals antes de guardarlos en base de datos y utilidades de importación.
- **`googleDrive.ts` y `drive.ts`**: gestión de carpetas/archivos en Google Drive utilizando credenciales de servicio y sincronización incremental.
- **`timezone.ts` y `time.ts`**: conversión de fechas a zona horaria de Madrid para exponer datos coherentes en frontend y reportes.
- **`sessions.ts`, `variant-resources.ts`, `variant-defaults.ts`**: helpers para componer sesiones, recursos y variaciones cuando se generan informes o se sincronizan plantillas.

## Frontend: organización y flujo de la aplicación
- **Punto de entrada**: `src/main.tsx` monta React Router y React Query, inicializando el contexto de la SPA.
- **Layout global (`App.tsx`)**: dibuja la barra de navegación, coordina los modales de detalle de presupuesto (Empresas, Abierta, Servicios, Material), centraliza los toasts globales y mantiene en `localStorage` la última ruta activa.
- **Router (`app/router.tsx`)**: carga lazy de todas las vistas (Presupuestos, Calendario, Recursos, Certificados, Informes) y maneja redirecciones legacy.
- **Consumo de API (`api/client.ts`)**: resuelve automáticamente la URL base según entorno (localhost vs Netlify), encapsula errores (`ApiError`) y expone utilidades de normalización.
- **Características clave**:
  - `features/presupuestos/`: gestión completa de deals (importación desde Pipedrive, detalle, productos, notas, documentos).
  - `features/calendar/`: vistas agrupadas por sesión, formador y unidad móvil, apoyadas en React Query.
  - `pages/recursos/`: catálogos de recursos (formadores, unidades móviles, salas, productos, formación abierta).
  - `pages/certificados/` y `pages/informes/`: workflows para plantillas de certificados y generación de informes.
  - `public/PublicSessionStudentsPage.tsx`: interfaz ligera para los enlaces públicos de alumnos, compartiendo validaciones con el backend.
- **Estilo y UI**: se apoya en Bootstrap 5 y componentes de `react-bootstrap`; los estilos globales viven en `styles.css`.
- **Tests**: configurados con Vitest + Testing Library (`npm run test --workspace frontend`).

## Datos y Prisma
El esquema `prisma/schema.prisma` modela las entidades principales:
- **Catálogo CRM**: `organizations`, `persons`, `deals`, `deal_products`, `deal_notes`, `deal_files`.
- **Planificación**: `sessions`, `session_comments`, `session_documents`, `session_templates`, `session_resources`.
- **Recursos**: `trainers`, `rooms`, `mobile_units`, `products`, `product_variants`, relaciones `variant_siblings` y ajustes específicos (`product_variant_settings`).
- **Acceso público**: `tokens` (sustituye al antiguo `session_public_links`) con información de auditoría, caducidad y estado.
- **Formación abierta y certificados**: tablas auxiliares para plantillas, cursos y variantes utilizadas en WooCommerce.

Prisma genera automáticamente el cliente tipado en `node_modules/.prisma/client` mediante `npm run generate` o durante el `postinstall` del proyecto.

## Integraciones externas
- **Pipedrive API**: importación/sincronización de deals, notas y documentos (`deals.ts`, `deal_documents.ts`, `_shared/pipedrive.ts`).
- **AWS S3**: almacenamiento de documentos internos con URLs firmadas y descargas (`deal_documents.ts`).
- **Google Drive**: sincronización opcional de carpetas de cliente y subida de documentos (`_shared/googleDrive.ts`).
- **OpenAI**: generación y mejora de informes (`generateReport.ts`, `improveReport.ts`).
- **WooCommerce**: sincronización de cursos (`woo_courses.ts`).

## Requisitos y configuración de entorno
### Requisitos mínimos
- Node.js >= 22.0.0 (>= 20.18.0 dentro del workspace frontend)
- npm >= 10.8.0
- Netlify CLI (opcional) para desarrollo local
- Acceso a la base de datos PostgreSQL (Neon) y a los servicios externos (S3, Google Drive, Pipedrive, OpenAI)

### Variables de entorno principales (`.env` en la raíz)
**Base de datos y autenticación**
- `DATABASE_URL` — cadena de conexión a PostgreSQL.
- `ALLOWED_EMAIL_DOMAIN` — dominio permitido para logins internos.
- `DEFAULT_NOTE_AUTHOR` — autor por defecto de notas importadas (opcional).

**Almacenamiento de documentos**
- `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — credenciales de AWS S3.
- `GOOGLE_DRIVE_CLIENT_EMAIL`, `GOOGLE_DRIVE_PRIVATE_KEY`, `GOOGLE_DRIVE_SHARED_DRIVE_ID`, `GOOGLE_DRIVE_BASE_FOLDER_NAME` — credenciales y configuración de Drive.

**Integraciones CRM y catálogos**
- `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_BASE_URL` (u otras credenciales necesarias).
- `WOO_API_KEY`, `WOO_API_SECRET`, `WOO_BASE_URL` (si se sincronizan cursos).

**Portal público de alumnos**
- `PUBLIC_SESSION_RATE_LIMIT_WINDOW_MS`, `PUBLIC_SESSION_RATE_LIMIT_MAX_REQUESTS` — control de rate limiting (opcional).

**Generación de informes**
- `OPENAI_API_KEY`, `OPENAI_BASE_URL` (opcional, por defecto `https://api.openai.com/v1`).
- `REPORTS_ALLOWED_ORIGIN` — origen permitido para CORS de informes.

> 🔒 No versionar archivos `.env` ni credenciales. Compartirlas mediante los canales seguros del equipo.

## Puesta en marcha local
1. **Instalar dependencias**
   ```bash
   npm install
   ```
2. **Generar Prisma Client** (se ejecuta también en `postinstall`)
   ```bash
   npm run generate
   ```
3. **Inicializar datos básicos (opcional)** — revisar `scripts/init-db.mjs` si está disponible en tu entorno privado.
   ```bash
   npm run db:init
   ```
4. **Levantar frontend + backend con Netlify CLI** (puerto 8888)
   ```bash
   npx netlify dev -p 8888
   ```
   - El frontend queda accesible en `http://localhost:8888` y proxea las funciones en `/.netlify/functions/*`.
   - Para trabajar solo con el frontend: `npm run dev --workspace frontend` (Vite en `http://localhost:5173`).
5. **Primer acceso**: si la tabla `users` está vacía, el primer inicio de sesión válido creará automáticamente un usuario admin
   con las credenciales utilizadas para arrancar el entorno.

## Scripts útiles
| Comando | Descripción |
| --- | --- |
| `npm run clean` | Elimina dependencias locales y artefactos de Prisma.
| `npm run typecheck:functions` | Type-check de todas las funciones Netlify.
| `npm run build` | Compila el frontend (previo `npm run build:frontend`).
| `npm run prisma:prune` | Elimina binarios de Prisma sobrantes durante builds en Netlify/CI.
| `npm run netlify:build` | Pipeline completo usado en Netlify (`generate` + prune + build).
| `npm run test --workspace frontend` | Ejecuta tests de la SPA con Vitest.
| `npm run typecheck --workspace frontend` | Comprueba tipos del frontend.

## Testing y calidad
- **Frontend**: `npm run test --workspace frontend` (Vitest) y `npm run typecheck --workspace frontend`.
- **Backend**: `npm run typecheck:functions` para validar los tipos en todas las funciones.
- **Linting/format**: el frontend incluye ESLint + Prettier (ejecutar manualmente desde el workspace si es necesario).

## Despliegue
- Netlify ejecuta `npm run netlify:build`, genera Prisma Client, limpia binarios innecesarios y compila el frontend.
- Las funciones se empaquetan automáticamente; `backend.toml` define rutas personalizadas, timeouts y bundling.
- Los deploys se producen al fusionar en la rama principal. Para un despliegue manual se puede usar:
  ```bash
  netlify deploy
  ```

## Onboarding y próximos pasos recomendados
1. **Reproducir el entorno local** siguiendo la guía anterior para familiarizarse con Netlify CLI, variables de entorno y comandos compartidos.
2. **Explorar el flujo de Presupuestos**: revisar `frontend/src/features/presupuestos` junto con `backend/functions/deals.ts`, `deal_notes.ts` y `deal_documents.ts` para entender el ciclo completo de importación, edición y documentos.
3. **Analizar el calendario y recursos**: estudiar `frontend/src/pages/calendario/*`, `backend/functions/sessions.ts`, `calendar-variants.ts` y los endpoints de catálogos (`trainers.ts`, `rooms.ts`, `mobile-units.ts`).
4. **Revisar el portal público de alumnos**: comprender cómo `public/PublicSessionStudentsPage.tsx` interactúa con `backend/functions/public-session-students.ts` y las tablas `tokens` y `session_students`.
5. **Entender la generación de informes**: examinar `backend/functions/generateReport.ts`, `improveReport.ts` y las plantillas relacionadas para extender reportes cuando sea necesario.
6. **Consultar el esquema Prisma**: usar `prisma/schema.prisma` como referencia principal para cualquier cambio de datos y sincronizarlo con Pipedrive/Google Drive.

---
¿Dudas? Puedes inspeccionar las funciones en `backend/functions/` y las vistas correspondientes en `frontend/src/` para localizar rápidamente la lógica relacionada.
