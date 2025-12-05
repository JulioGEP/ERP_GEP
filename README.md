# ERP GEP · Guía completa

Este monorepo reúne el panel interno de GEP (frontend React) y el backend de funciones serverless (Netlify Functions) que exponen la API y tareas batch. El objetivo de esta guía es que cualquier persona pueda entender rápidamente qué hace la aplicación, cómo se estructura y cómo extenderla sin perder el contexto operativo.

- [Arquitectura de alto nivel](#arquitectura-de-alto-nivel)
- [Mapa de carpetas](#mapa-de-carpetas)
- [Dominios de negocio y flujos](#dominios-de-negocio-y-flujos)
- [Autenticación, roles y permisos](#autenticación-roles-y-permisos)
- [Backend](#backend)
- [Frontend](#frontend)
- [Datos y Prisma](#datos-y-prisma)
- [Configuración de entorno](#configuración-de-entorno)
- [Ejecución local](#ejecución-local)
- [Scripts y comprobaciones](#scripts-y-comprobaciones)
- [Despliegue](#despliegue)
- [Cómo contribuir y extender el producto](#cómo-contribuir-y-extender-el-producto)

## Arquitectura de alto nivel
- **Monorepo Node.js**: un único `package.json` gestiona dependencias compartidas y scripts raíz (p. ej. generación del cliente Prisma).
- **Backend serverless**: funciones TypeScript empaquetadas por Netlify (`backend/functions`) actúan como API REST y trabajos bajo demanda. Comparten librerías comunes en `_shared`/`_lib`.
- **Frontend SPA**: React 18 + Vite con React Router v7 y React Query. El bundle se publica junto con las funciones en Netlify y consume la API vía los redirects `/api/*`.
- **Base de datos**: PostgreSQL gestionado con Prisma; las funciones incluyen el cliente compilado en los artefactos para evitar instalaciones en frío.
- **Integraciones externas**: Pipedrive (CRM), AWS S3 y Google Drive (documentos), OpenAI (informes), WooCommerce (catálogo de cursos).

## Mapa de carpetas
```
├── backend/                  # Workspace de funciones Netlify
│   ├── functions/
│   │   ├── _lib/             # Bootstrap de Prisma y helpers de bajo nivel
│   │   ├── _shared/          # Utilidades transversales (respuestas HTTP, Pipedrive, Drive…)
│   │   ├── *.ts              # Una función = un endpoint (ver sección Backend)
│   │   └── types/            # Tipos compartidos entre funciones
│   └── tsconfig.json
├── frontend/                 # Workspace del panel React
│   ├── src/
│   │   ├── api/              # Cliente HTTP y adaptadores
│   │   ├── app/              # Router y componentes de layout
│   │   ├── features/         # Lógica por dominio (presupuestos, calendario, etc.)
│   │   ├── pages/            # Páginas asociadas a rutas
│   │   ├── public/           # Flujos públicos para alumnos
│   │   └── shared/|utils/    # Hooks, helpers y componentes genéricos
│   └── package.json
├── prisma/
│   ├── schema.prisma         # Modelo de datos único
│   └── migrations/           # Migraciones generadas por Prisma (si existen)
├── scripts/                  # Utilidades CLI (limpieza de Prisma, SQL puntual)
├── backend.toml              # Build del workspace backend para Netlify
├── netlify.toml              # Redirects y bundling final
└── tsconfig.json             # Configuración TS en la raíz
```

## Dominios de negocio y flujos
- **Presupuestos (deals)**: importación y sincronización con Pipedrive, edición de datos internos, notas y documentos. La API vive en `backend/functions/deals.ts`, `deal_notes.ts` y `deal_documents.ts`. El frontend trabaja en `frontend/src/features/presupuestos` y páginas bajo `pages/presupuestos/*`.
- **Planificación y calendario**: sesiones, recursos y vistas agrupadas por sesión, formador o unidad móvil. Funciones principales: `sessions.ts`, `calendar-variants.ts`, `resources-confirmations.ts`, `session_comments.ts`, `session_documents.ts`. La UI está en `pages/calendario/*` y `features/calendar`.
- **Recursos**: catálogos de formadores, unidades móviles, salas, productos y variantes (`trainers.ts`, `rooms.ts`, `mobile-units.ts`, `products.ts`, `product-variants-create.ts`, `product-variant-settings.ts`, `variant-siblings.ts`, `products-variants.ts`). Las vistas están en `pages/recursos/*`.
- **Portal público de alumnos**: enlaces públicos protegidos por token y rate limiting para alta/baja/edición de alumnos (`public-session-students.ts`, `alumnos.ts`, `session_public_links.ts`). El frontend dedicado está en `src/public/PublicSessionStudentsPage.tsx`.
- **Informes y certificados**: generación/mejora de informes con OpenAI (`generateReport.ts`, `improveReport.ts`, `reportUpload.ts`, `reportPrefill.ts`) y gestión de plantillas/credenciales (`training-templates.ts`, `woo_courses.ts`). Las páginas están en `pages/informes/*` y `pages/certificados/*`.
- **Panel de formadores**: dashboard y carga de informes desde el rol formador (`trainer-dashboard.ts`, `trainer-sessions.ts`, `trainer-session-time-logs.ts`, `trainer_documents.ts`, `trainer-availability.ts`). UI bajo `pages/usuarios/trainer/*`.
- **Reporting interno**: endpoints de auditoría y reportes (`audit-events.ts`, `reporting-logs.ts`, `reporting-horas-formadores.ts`, `reporting-control-horario.ts`, `reporting-costes-extra.ts`) consumidos desde `pages/reporting/*` y `pages/dashboard/*`.

## Autenticación, roles y permisos
- **Backend**: las funciones `/auth-*` manejan login/logout, sesión y reseteo de contraseña. Las rutas protegidas validan el usuario mediante cookies HttpOnly y, cuando procede, verifican permisos específicos.
- **Frontend**: `AuthProvider` (`frontend/src/context/AuthContext.tsx`) mantiene el usuario, roles y permisos. `RequireAuth` y `GuardedRoute` bloquean vistas si el rol o el permiso de ruta no coincide. Las comprobaciones de permisos admiten comodines (`/calendario/*`).

### Roles habituales
- **Admin/Operaciones**: acceso completo al panel, gestión de catálogos, presupuestos y calendario.
- **Formador**: acceso restringido al dashboard de sesiones, carga de documentos y disponibilidad.
- **Solo lectura**: rutas limitadas a consulta según el array de permisos devuelto por `/auth-session`.

## Backend
- **Patrón por función**: cada archivo `*.ts` en `backend/functions` expone un handler HTTP (event, context) con CORS unificado mediante `_shared/response.ts` y acceso a Prisma desde `_shared/prisma.ts` o `_lib/db.ts`.
- **Integraciones**:
  - `pipedrive.ts`: cliente ligero para deals/notas/documentos.
  - `googleDrive.ts` y `drive.ts`: sincronización de carpetas/archivos y subida con credenciales de servicio.
  - `timezone.ts`/`time.ts`: normalización de fechas a Europa/Madrid para API y reportes.
- **Documentos**: `deal_documents.ts` gestiona URLs firmadas en S3, descargas proxy desde Pipedrive y sincronización opcional con Google Drive. `documents.ts` y `session_documents.ts` cubren otros flujos de ficheros.
- **Calendario y recursos**: helpers en `_shared/sessions.ts`, `variant-resources.ts` y `variant-defaults.ts` componen sesiones, recursos y variaciones antes de exponerlas.
- **Seguridad**: rate limiting en API pública (`public-session-students.ts`), validación de dominio permitido para autenticación y logging de auditoría (`audit-events.ts`, `_shared/audit-log`).
- **Healthcheck**: `/api/health` redirige a `health.ts` para monitorización.

## Frontend
- **Entrada y layout**: `src/main.tsx` monta React Query y Router. `App.tsx` gestiona la navegación principal, los modales de presupuestos y la restauración de la última ruta en `localStorage`.
- **Routing**: `src/app/router.tsx` declara todas las rutas protegidas. Las secciones principales son `/presupuestos/*`, `/calendario/*`, `/recursos/*`, `/certificados`, `/informes/*`, `/reporting/*`, `/usuarios/*` (incluido el subpanel de formadores) y `/perfil`.
- **Consumo de API**: `api/client.ts` resuelve automáticamente la base URL (local vs Netlify), normaliza errores con `ApiError` y expone `getJson`/`postJson` reutilizados en features.
- **Estado y datos**: React Query gestiona la cache de peticiones. Hooks en `shared` y `utils` encapsulan patrones comunes (formularios, toasts, validaciones).
- **Estilos**: Bootstrap 5 + `react-bootstrap` con ajustes globales en `styles.css`.
- **Testing**: Vitest + Testing Library (`npm run test --workspace frontend`).

## Datos y Prisma
- **Modelo**: `prisma/schema.prisma` define entidades de CRM (`organizations`, `persons`, `deals`, `deal_products`, `deal_notes`, `deal_files`), planificación (`sessions`, `session_resources`, `session_comments`, `session_documents`, `session_templates`), recursos (`trainers`, `rooms`, `mobile_units`, `products`, `product_variants`, `variant_siblings`, `product_variant_settings`), acceso público (`tokens`, `session_students`, `session_public_links`) y catálogos externos (WooCommerce, plantillas).
- **Cliente**: el binario Prisma se incluye en el bundle de Netlify (`netlify.toml`/`backend.toml`). `npm run generate` produce el cliente tipado antes de compilar o ejecutar funciones.

## Configuración de entorno
Variables principales en un `.env` en la raíz (no versionado):
- **Base de datos y autenticación**: `DATABASE_URL`, `ALLOWED_EMAIL_DOMAIN`, `DEFAULT_NOTE_AUTHOR`.
- **Documentos**: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `GOOGLE_DRIVE_CLIENT_EMAIL`, `GOOGLE_DRIVE_PRIVATE_KEY`, `GOOGLE_DRIVE_SHARED_DRIVE_ID`, `GOOGLE_DRIVE_BASE_FOLDER_NAME`.
- **Integraciones**: `PIPEDRIVE_API_TOKEN`, `PIPEDRIVE_BASE_URL`, `WOO_API_KEY`, `WOO_API_SECRET`, `WOO_BASE_URL`.
- **Portal público**: `PUBLIC_SESSION_RATE_LIMIT_WINDOW_MS`, `PUBLIC_SESSION_RATE_LIMIT_MAX_REQUESTS`.
- **Informes**: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `REPORTS_ALLOWED_ORIGIN`.

## Ejecución local
1. **Instalar dependencias** (monorepo):
   ```bash
   npm install
   ```
2. **Generar Prisma Client** (también corre en `postinstall`):
   ```bash
   npm run generate
   ```
3. **Levantar entorno completo con Netlify CLI** (frontend + funciones proxied):
   ```bash
   npx netlify dev -p 8888
   ```
   - UI: `http://localhost:8888`
   - API: `http://localhost:8888/.netlify/functions/*` (o `/api/*` gracias a los redirects).
4. **Trabajar solo con el frontend** (opcional):
   ```bash
   npm run dev --workspace frontend
   ```

## Scripts y comprobaciones
Comandos más usados desde la raíz:
- `npm run clean` — Limpia dependencias y artefactos de Prisma.
- `npm run generate` — Genera cliente Prisma para backend/frontend.
- `npm run build` — Compila el frontend (invoca `build:frontend`).
- `npm run typecheck:functions` — Type-check de todas las funciones Netlify.
- `npm run prisma:format` — Formatea `prisma/schema.prisma` usando el binario local del workspace backend.
- `npm run prisma:prune` — Elimina binarios Prisma sobrantes en CI/Netlify.
- `npm run netlify:build` — Pipeline de despliegue (generate + prune + build).
- `npm run test --workspace frontend` — Tests de la SPA.
- `npm run typecheck --workspace frontend` — Comprobación de tipos en frontend.

## Despliegue
- Netlify ejecuta `npm run netlify:build`, incluye el cliente Prisma necesario y compila el bundle del frontend.
- `netlify.toml` define redirects: `/api/*` → `/.netlify/functions/:splat`, rutas explícitas para `/auth/*` y healthcheck, y fallback SPA.
- `backend.toml` fija el comando de build del workspace backend y los módulos externos incluidos en cada función.

## Cómo contribuir y extender el producto
1. **Familiarízate con el dominio que quieres tocar**: revisa el par backend/frontend correspondiente (p. ej. presupuestos → `deals.ts` + `features/presupuestos`).
2. **Añade lógica de negocio**: crea o modifica funciones en `backend/functions`. Usa `_shared/response.ts` para respuestas coherentes y `_shared/prisma.ts` para el cliente. Registra eventos críticos en el audit log si aplica.
3. **Expone nuevos endpoints al frontend**: declara redirects en `netlify.toml` solo si necesitas rutas adicionales fuera del catch-all `/api/*`.
4. **Integra en la UI**: añade páginas o componentes bajo `frontend/src/pages` o `frontend/src/features` y protégelos con `RequireAuth`/`GuardedRoute` si requieren permisos.
5. **Datos**: modifica `prisma/schema.prisma`, genera migraciones y ejecuta `npm run generate`. Actualiza seeds o scripts si procede.
6. **Prueba antes de subir**: ejecuta typechecks y, en frontend, tests de Vitest. Usa Netlify CLI para validar el flujo completo.

Con esta guía deberías poder navegar el código, comprender los flujos clave y iterar sobre la plataforma sin romper integraciones ni despliegues.
