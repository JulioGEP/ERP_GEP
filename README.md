# ERP GEP – Planificación de formaciones

## Visión del proyecto
ERP interno colaborativo para planificar, visualizar y gestionar formaciones procedentes de Pipedrive. El sistema debe permitir que varios miembros del equipo trabajen simultáneamente y dispongan de la información actualizada en tiempo real.

## Decisiones iniciales de arquitectura
- **Separación Front/Back:** aplicaciones independientes comunicadas mediante API REST segura.
- **Front-end:**
  - Framework: **React** (Vite + TypeScript) para facilitar la creación y edición ágil de componentes UI.
  - UI: **Bootstrap 5** con personalización de paleta corporativa y componentes modales/tablas adaptados.
  - Estado y datos: React Query para manejo de peticiones en tiempo real y cacheo con invalidaciones inmediatas.
- **Back-end:**
  - Runtime: **Node.js** con **Express** + TypeScript para crear endpoints claros y escalables.
  - ORM: **Prisma** conectado a Neon (PostgreSQL) para definir el esquema, generar migraciones y mantener consistencia.
  - Sincronización en tiempo real: endpoints que consultan Pipedrive bajo demanda y actualizan la base de datos; se incorporará WebSocket/SSE en fases posteriores para pushes colaborativos.
- **Base de datos:** PostgreSQL en Neon, estructurada según las tablas y relaciones descritas (Organizations, Persons, Deals, Notes, Documents, Seassons, Trainers, UnidadesMoviles).
- **Integraciones externas:** SDK/API de Pipedrive consumida desde el backend, con token almacenado en variables de entorno (Netlify + backend hosting a definir).

## Flujo de datos (high-level)
1. Usuario introduce número federal desde el front (modal Bootstrap).
2. Front envía la petición al backend (`POST /deals/import`).
3. Backend consulta Pipedrive, transforma los datos y actualiza/inserta en Neon mediante Prisma.
4. Backend responde con los datos normalizados; front los muestra en tabla responsive.
5. Acciones de edición desde el front dispararán endpoints REST que actualizan Neon y devuelven el estado actualizado inmediatamente.

## Roadmap inmediato
1. **Inicializar repositorio**
   - Configurar monorepo simple (`frontend/`, `backend/`) con toolings base.
   - Añadir linting/formatting (ESLint, Prettier) y scripts compartidos.
2. **Backend MVP**
   - Definir esquema Prisma según estructura suministrada y preparar migraciones.
   - Implementar endpoint de importación de deals desde Pipedrive con autenticación por API key.
   - Añadir servicios para normalizar productos `form-` y guardar relaciones.
3. **Frontend MVP**
   - Montar layout con header, menú de pestañas y sección “Presupuestos”.
   - Implementar modal para capturar número federal y tabla inicial de resultados.
   - Consumir endpoint `POST /deals/import` y listar datos básicos (Presupuesto, Título, Cliente, Sede, Formación).
4. **Colaboración en tiempo real**
   - Evaluar SSE/WebSockets (p.ej. Socket.IO) para notificar cambios simultáneos.
5. **Documentación continua**
   - Mantener este README actualizado con decisiones y procesos.

## Próximos pasos sugeridos para la siguiente iteración
- Crear estructura base del proyecto con carpetas `frontend/` y `backend/`.
- Configurar Vite + React + TypeScript con Bootstrap y variables de color corporativo suavizadas.
- Inicializar backend Express + TypeScript + Prisma y establecer conexión con Neon usando `DATABASE_URL`.
- Definir primer esquema Prisma y migración inicial que refleje las tablas descritas.

Este documento servirá como referencia viva para las decisiones técnicas y planificación del ERP.

## Estructura del repositorio

```
.
├── backend/        # API Express + Prisma conectada a Neon
├── frontend/       # Aplicación React (Vite + TypeScript + Bootstrap)
├── .env.example    # Plantilla de variables de entorno
├── package.json    # Configuración de workspaces y scripts compartidos
└── README.md
```

## Cómo empezar

1. **Instalar dependencias**

   ```bash
   npm install
   npm --workspace backend install
   npm --workspace frontend install
   ```

2. **Configurar variables de entorno**

   Copia `.env.example` a `.env` y rellena los valores proporcionados por Netlify/Neon.

3. **Lanzar los entornos de desarrollo**

   ```bash
   npm run dev:backend   # http://localhost:4000
   npm run dev:frontend  # http://localhost:5173
   ```

## Convenciones de diseño UI

- Tipografía principal: Poppins (variantes 300/400/600/700).
- Colores corporativos suavizados:
  - Rojo principal: `#e8474d`
  - Gris oscuro: `#2a2a2a`
  - Gris medio: `#565656`
  - Gris claro: `#f2f2f2`
- Componentes clave personalizados: botones, navegación superior, tablas y modales Bootstrap adaptados a la línea visual.

## Estado actual

- **Frontend**: layout inicial con cabecera corporativa, pestañas de navegación y módulo de Presupuestos con modal de importación, tabla responsive y modal de detalle.
- **Backend**: servidor Express con endpoint `POST /api/deals/import` preparado para sincronizar un presupuesto desde Pipedrive, normalizar datos y guardarlos en Neon mediante Prisma.
- **Base de datos**: esquema Prisma que refleja las tablas y relaciones solicitadas (organizaciones, personas, deals, notas, documentos, sesiones, formadores y unidades móviles).
## Despliegue en Netlify

- El frontend se publica desde `frontend/dist`.
- Netlify está configurado con `netlify.toml` en la raíz:
  - `base = "frontend"`
  - `publish = "dist"`
  - `command = "npm ci && npm run build"`
- Redirecciones SPA:
  - `frontend/public/_redirects`
  - Reglas espejo en `netlify.toml`
- Variables de entorno recomendadas (Netlify → Site settings → Environment variables):
  - `VITE_API_BASE=https://<TU_BACKEND>/api` (si el backend vive en otro host)
