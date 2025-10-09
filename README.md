# ERP GEP · Plataforma Operativa

## 🧭 Visión general
ERP GEP es un monorepo que centraliza la operativa del área de formación de GEP Group. El proyecto
permite importar presupuestos desde Pipedrive, enriquecerlos con información operativa y planificar
recursos (formadores, salas y unidades móviles) desde una única interfaz web.

El repositorio reúne:
- **Frontend** en React + Vite para la gestión diaria del equipo.
- **Backend** serverless con Netlify Functions y Prisma para exponer APIs REST.
- **Base de datos PostgreSQL** (Neon) como fuente de verdad de deals, sesiones y recursos.
- **Integraciones externas** con Pipedrive (CRM) y AWS S3 para documentos.

## 🏛️ Arquitectura
```
monorepo
├── frontend/        Aplicación React (Vite, React Query, React Bootstrap)
├── backend/         Netlify Functions (TypeScript, Prisma Client)
├── prisma/          Esquema y cliente de base de datos
├── scripts/         Utilidades (inicialización de BBDD, etc.)
└── package.json     Scripts y dependencias comunes
```

### Componentes principales
- **Aplicación web (frontend)**: consulta presupuestos, muestra detalles, planifica sesiones y administra recursos.
- **Funciones serverless (backend/functions)**: exponen endpoints REST y encapsulan la lógica de importación, sincronización y CRUD.
- **Prisma ORM**: actúa como capa de acceso a datos sobre PostgreSQL y genera el cliente compartido por las funciones.
- **Infraestructura Netlify**: despliega el frontend como sitio estático y las funciones como lambdas, permitiendo también ejecución local via `netlify dev`.

## 💻 Frontend
- **Stack:** React 18, TypeScript, Vite, React Query, React Bootstrap, Bootstrap 5.
- **Vistas disponibles:**
  - *Presupuestos*: listado de deals sin sesiones, importación desde Pipedrive, consulta de detalles, edición de campos operativos, notas y documentos.
  - *Recursos / Formadores*: directorio editable de formadores/bomberos vinculados a sesiones.
  - *Recursos / Unidades*: gestión de unidades móviles con asignación a sesiones.
  - *Recursos / Salas*: catálogo de salas con disponibilidad.
  - *Calendario* (placeholder actual) reservado para planning global.
- **Estado y datos:** React Query gestiona caché y refetch manual; los componentes consumen la API REST expuesta por las funciones.
- **UI/UX:** Navbar con navegación contextual, modales para importación, tabla de presupuestos con filtros, toasts globales y estilos basados en Bootstrap.

## 🔗 Backend (Netlify Functions)
Cada endpoint se implementa como función independiente en `backend/functions`. Las funciones comparten
utilidades (`backend/functions/_shared`) para Prisma, respuestas HTTP, formateo de fechas y cliente de Pipedrive.

| Endpoint | Método | Descripción |
| --- | --- | --- |
| `/deals/import` | POST | Importa un presupuesto desde Pipedrive y lo normaliza antes de guardarlo. |
| `/deals?noSessions=true` | GET | Devuelve presupuestos pendientes de planificar sesiones. |
| `/deals/:dealId` | GET | Obtiene el detalle completo del presupuesto (productos, notas, documentos). |
| `/deals/:dealId` | PATCH | Actualiza campos operativos editables (sede, dirección, etiquetas CAES/FUNDAE, hotel, alumnos). |
| `/deals/:dealId` | DELETE | Elimina un presupuesto del ERP y sus dependencias. |
| `/deal_notes` | POST | Añade notas operativas asociadas al deal. |
| `/deal_documents` | POST | Genera URL firmada de S3 para subir documentos y registra metadatos. |
| `/deal-sessions` | GET/POST/PATCH | Gestiona sesiones planificadas y su relación con productos. |
| `/trainers`, `/rooms`, `/mobile-units` | GET/POST/PATCH | CRUD de recursos disponibles. |
| `/health` | GET | Healthcheck simple de la plataforma. |

## 🗄️ Modelo de datos (Prisma / PostgreSQL)
Las tablas principales se definen en `prisma/schema.prisma`:
- **organizations, persons**: entidades sincronizadas desde Pipedrive.
- **deals**: presupuesto principal con campos operativos (`sede_label`, `training_address`, etiquetas CAES/FUNDAE, etc.).
- **deal_products**: productos contratados con horas, tipo, categoría y relación con sesiones planificadas.
- **deal_notes, deal_files**: notas y documentos asociados al presupuesto.
- **deal_sessions**: sesiones planificadas (estado, fecha/hora, sede, sala, comentarios, recursos vinculados).
- **deal_session_trainers / deal_session_mobile_units**: relaciones N:N entre sesiones y recursos.
- **trainers, salas, unidades_moviles**: catálogos de recursos internos.

Todas las fechas se normalizan a la zona horaria de Madrid en base de datos y en las respuestas de API.

## 🔁 Flujos clave
1. **Importación 1:1 desde Pipedrive:**
   - Lectura del deal y sus entidades relacionadas (organización, persona, productos, notas, ficheros).
   - Transformación de campos personalizados y opciones (horas, tipo, categoría) mediante la capa `mappers`.
   - Upsert completo en Neon, asegurando integridad referencial y limpieza de dependencias obsoletas.
2. **Gestión operativa del presupuesto:**
   - Edición de campos permitidos y creación de notas desde la UI.
   - Registro y consulta de documentos con URLs firmadas en S3.
3. **Planificación de sesiones:**
   - Creación/actualización de sesiones ligadas a productos, con asignación de formadores, salas y unidades móviles.
   - Estados (`Borrador`, `Planificada`, `Suspendido`, `Cancelado`) gestionados desde la API.
4. **Catálogo de recursos:**
   - CRUD completo sobre formadores, salas y unidades móviles, utilizado en la planificación de sesiones.

## ⚙️ Puesta en marcha local
1. **Requisitos previos**
   - Node.js ≥ 22 (monorepo) y npm ≥ 10.8.
   - Acceso a una base de datos PostgreSQL (Neon en producción) y credenciales de Pipedrive + AWS S3.
   - Netlify CLI (`npm install -g netlify-cli`) para emular funciones y frontend.

2. **Instalación**
   ```bash
   npm install          # instala dependencias del monorepo
   npm run generate     # genera el cliente de Prisma
   ```

3. **Variables de entorno**
   Crear un `.env` en la raíz con al menos:
   ```env
   DATABASE_URL=postgresql://user:pass@host:5432/db
   PIPEDRIVE_API_TOKEN=xxxx
   PIPEDRIVE_BASE_URL=https://api.pipedrive.com/v1        # opcional override
   PD_PRODUCT_HOURS_KEY=hours                             # opcional override
   PD_PRODUCT_TYPE_KEY=type                               # opcional override
   PD_PRODUCT_CATEGORY_KEY=category                       # opcional override
   S3_BUCKET=erp-gep-documents
   S3_REGION=eu-west-1
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   CORS_ORIGIN=https://erp.gep.group                      # origen permitido
   ```
   > Las funciones fallarán si falta alguna variable crítica; se utiliza `requireEnv` para validar presencia.

4. **Inicializar base de datos (opcional)**
   ```bash
   npm run db:init   # ejecuta scripts/init-db.mjs usando dotenv-cli
   ```

5. **Desarrollo local**
   ```bash
   netlify dev -p 8888
   ```
   - Vite servirá el frontend en `http://localhost:8888`.
   - Las funciones estarán disponibles con rutas `/api/...` según configuración de Netlify.

6. **Build de producción**
   ```bash
   npm run build        # instala frontend, genera build y ejecuta Prisma generate
   netlify deploy --prod
   ```

## 🧪 Calidad y mantenimiento
- **Type checking:** `npm run typecheck:functions` para funciones y `npm --prefix frontend run typecheck` para la app.
- **Linter/Formato:** ESLint + Prettier configurados en el proyecto (aplicar con los comandos habituales del equipo).
- **Convenciones:**
  - Commits usando Conventional Commits.
  - Ramas `feature/*` o `fix/*`.
  - No versionar archivos `.env` ni secretos.

## 🚀 Roadmap inmediato
- Sincronización completa de documentos desde Pipedrive (histórico vs. presigned).
- Previsualización de documentos sin acceso a Pipedrive.
- Subida directa de documentos desde modales del frontend (guardando `file_name` y `storage_key`).
- Panel de sesiones vinculadas a cada presupuesto y vista calendario global.
- Integración WebSocket/SSE para actualizaciones en tiempo real.
- Dashboard de métricas y carga operativa.

## 🤝 Workflow de contribución
1. Crear rama `feature/<nombre>` o `fix/<nombre>`.
2. Implementar cambios, asegurando tests/chequeos.
3. `git commit` siguiendo la convención.
4. Abrir Pull Request con resumen claro y checklist de QA.
5. Integrar vía `gh pr merge` (squash o merge según política de equipo).

Documentación viva: mantén este README actualizado con cualquier cambio relevante en el flujo o la arquitectura.
