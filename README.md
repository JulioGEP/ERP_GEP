# ERP GEP

ERP GEP es un **monorepo** que concentra toda la operación de una plataforma interna de formación: ciclo comercial, planificación, ejecución, documentación y control.

Este README está pensado como **guía técnica y funcional detallada** para que cualquier persona del equipo pueda:

- Entender rápidamente **qué hace** el sistema.
- Ubicar **dónde vive cada parte** en el código.
- Comprender **cómo fluye la información** entre módulos.
- Arrancar entorno local y validar cambios con un flujo de trabajo consistente.

---

## Tabla de contenidos

- [1) Qué resuelve este ERP](#1-qué-resuelve-este-erp)
- [2) Visión de arquitectura](#2-visión-de-arquitectura)
- [3) Stack técnico](#3-stack-técnico)
- [4) Estructura real del repositorio](#4-estructura-real-del-repositorio)
- [5) Funcionamiento end-to-end del sistema](#5-funcionamiento-end-to-end-del-sistema)
- [6) Módulos funcionales y dónde están en código](#6-módulos-funcionales-y-dónde-están-en-código)
- [7) Backend en detalle: patrón de Netlify Functions](#7-backend-en-detalle-patrón-de-netlify-functions)
- [8) Frontend en detalle: páginas, features y estado](#8-frontend-en-detalle-páginas-features-y-estado)
- [9) Autenticación, roles y permisos](#9-autenticación-roles-y-permisos)
- [10) Modelo de datos (Prisma)](#10-modelo-de-datos-prisma)
- [11) Integraciones externas](#11-integraciones-externas)
- [12) Variables de entorno](#12-variables-de-entorno)
- [13) Puesta en marcha local](#13-puesta-en-marcha-local)
- [14) Comandos útiles](#14-comandos-útiles)
- [15) Flujo recomendado para cambios](#15-flujo-recomendado-para-cambios)
- [16) Despliegue en Netlify](#16-despliegue-en-netlify)
- [17) Documentación funcional adicional](#17-documentación-funcional-adicional)

## 1) Qué resuelve este ERP

El sistema unifica en una sola plataforma procesos que habitualmente están repartidos en varias herramientas:

- Gestión comercial de **presupuestos/deals**.
- Planificación de **sesiones formativas**.
- Asignación de **recursos** (personas, espacios y medios).
- Interacción externa mediante **portal público de alumnos**.
- Generación de **informes y certificados**.
- **Reporting** operativo y de control para seguimiento interno.

Resultado práctico: más trazabilidad, menos trabajo manual y menos pérdida de información entre áreas.

## 2) Visión de arquitectura

A nivel lógico, la arquitectura sigue este patrón:

1. **Frontend React** (operación diaria interna + flujos públicos concretos).
2. **API serverless** en `backend/functions` (reglas de negocio y acceso a datos).
3. **Prisma + PostgreSQL** como capa de persistencia.
4. **Servicios externos** (Pipedrive, S3, Google Drive, OpenAI, WooCommerce).

### Esquema simplificado

```text
Usuario interno (navegador)
        │
        ▼
Frontend React (Vite)
        │ llamadas /api/*
        ▼
Netlify Functions (TypeScript)
        │
        ├── Prisma Client ──► PostgreSQL
        └── Integraciones ──► Pipedrive / S3 / Drive / OpenAI / WooCommerce
```

## 3) Stack técnico

- **Lenguaje base**: TypeScript.
- **Frontend**: React 18 + Vite + React Router + React Query + Bootstrap 5.
- **Backend**: Netlify Functions (Node.js + TypeScript).
- **Datos**: PostgreSQL + Prisma ORM.
- **Infra/hosting**: Netlify (build + functions + redirects).

## 4) Estructura real del repositorio

```text
ERP_GEP/
├── backend/
│   ├── functions/               # Endpoints serverless y utilidades de backend
│   │   ├── _lib/                # Helpers y bootstrap de infraestructura
│   │   ├── _shared/             # Utilidades compartidas (auth, HTTP, integraciones)
│   │   ├── types/               # Tipos usados por múltiples funciones
│   │   └── *.ts                 # Funciones por dominio (deals, sessions, etc.)
│   ├── prisma/                  # Esquema/migraciones del workspace backend
│   ├── sql/                     # SQL de soporte y evolutivos puntuales
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/                 # Cliente API y normalización de llamadas
│   │   ├── app/                 # Configuración de aplicación y routing principal
│   │   ├── components/          # Componentes reutilizables transversales
│   │   ├── context/             # Context providers globales (ej. auth)
│   │   ├── features/            # Módulos por dominio funcional
│   │   ├── pages/               # Páginas de navegación interna
│   │   ├── public/              # Páginas de acceso externo por token
│   │   └── shared/              # Helpers/UI utilities compartidas
│   ├── public/                  # Assets estáticos
│   └── package.json
├── prisma/
│   ├── schema.prisma            # Modelo principal de datos (raíz)
│   └── migrations/              # Historial evolutivo de base de datos
├── docs/                        # Documentación funcional y mapas
├── scripts/                     # Automatizaciones de mantenimiento
├── netlify.toml                 # Configuración principal de Netlify
├── backend.toml                 # Configuración específica build backend
└── README.md
```

## 5) Funcionamiento end-to-end del sistema

Este es el flujo típico de trabajo de negocio:

1. Se crea/actualiza una oportunidad en el módulo de **presupuestos**.
2. Esa oportunidad se aterriza en **sesiones** dentro del calendario operativo.
3. Sobre cada sesión se asignan **recursos** (formadores, salas, materiales, variantes).
4. Se habilita el **portal público** para altas/bajas/ediciones de alumnado cuando aplica.
5. La ejecución produce **informes**, adjuntos y potenciales **certificados**.
6. Toda la actividad deja rastro en **reporting** (logs, horas, control, costes).

Este diseño permite separar claramente:

- **Entrada comercial** (deals).
- **Ejecución operativa** (calendario + recursos).
- **Salida documental** (informes/certificados).
- **Control de gestión** (reporting).

## 6) Módulos funcionales y dónde están en código

### 6.1 Presupuestos / CRM

- **Backend**: funciones de deals y documentos/notas asociadas en `backend/functions/`.
- **Frontend**: `frontend/src/features/presupuestos` y rutas bajo `frontend/src/routes/presupuestos`.
- **Responsabilidad**: gestionar oportunidad comercial y su contexto documental.

### 6.2 Calendario y sesiones

- **Backend**: funciones centradas en sesiones, comentarios y adjuntos de sesión en `backend/functions/`.
- **Frontend**: `frontend/src/features/calendar` y páginas de calendario/control horario.
- **Responsabilidad**: planificar ejecución real de acciones formativas.

### 6.3 Recursos

- **Backend**: catálogos como `trainers`, `rooms`, `mobile-units`, `products`, `variant-siblings`.
- **Frontend**: vistas de recursos en `frontend/src/features/recursos` y `frontend/src/pages/recursos`.
- **Responsabilidad**: alta/mantenimiento de recursos y disponibilidad operativa.

### 6.4 Portal público de alumnos

- **Backend**: endpoints de acceso público por token (alumnos y sesión pública) en `backend/functions/`.
- **Frontend**: páginas públicas en `frontend/src/public`.
- **Responsabilidad**: permitir interacción externa controlada sin abrir el panel interno.

### 6.5 Informes, certificados y área de formadores

- **Backend**: generación/mejora/carga de informes, endpoints de panel de formadores.
- **Frontend**: `frontend/src/pages/informes`, `frontend/src/features/certificados`, `frontend/src/pages/usuarios/trainer`.
- **Responsabilidad**: salida documental y operativa diaria del personal formador.

### 6.6 Reporting y control

- **Backend**: funciones de logs, auditoría, control horario y costes.
- **Frontend**: páginas de reporting y dashboard en `frontend/src/pages/reporting` y `frontend/src/pages/dashboard`.
- **Responsabilidad**: seguimiento, control y explotación de la información.

## 7) Backend en detalle: patrón de Netlify Functions

En `backend/functions` cada archivo suele representar un endpoint o grupo de endpoints de un dominio.

Patrón habitual:

1. Parseo/validación de request.
2. Resolución de identidad/permisos.
3. Lógica de negocio.
4. Lectura/escritura con Prisma.
5. Respuesta HTTP normalizada.

### Qué revisar al tocar backend

- Contrato de entrada/salida del endpoint.
- Impacto en permisos/roles.
- Uso correcto de Prisma (relaciones incluidas, transacciones si aplica).
- Manejo de errores y códigos HTTP consistentes.
- Si hay integración externa, timeouts/reintentos y trazabilidad mínima.

## 8) Frontend en detalle: páginas, features y estado

El frontend separa responsabilidades para facilitar mantenimiento:

- **`pages/`**: composición de pantalla y navegación.
- **`features/`**: lógica por dominio (API + componentes + utilidades de negocio).
- **`components/` / `shared/`**: piezas reutilizables transversales.
- **`context/`**: estado global (ej. sesión/autenticación).

### Convención práctica

Cuando añadas una funcionalidad nueva:

1. Crear/ajustar capa API en el dominio correspondiente.
2. Encapsular lógica de negocio en `features/<dominio>`.
3. Mantener `pages/` como capa de ensamblado de UI.
4. Evitar duplicar utilidades globales ya existentes en `shared/`.

## 9) Autenticación, roles y permisos

- Los endpoints de autenticación viven en funciones `auth-*` del backend.
- El frontend centraliza estado de sesión en `frontend/src/context/AuthContext.tsx`.
- El enrutado protegido usa guardas de autenticación/autorización.
- Los permisos se aplican por capacidad funcional y/o ruta.

Recomendación: cualquier endpoint nuevo debe nacer con su política de acceso explícita.

## 10) Modelo de datos (Prisma)

- Esquema principal: `prisma/schema.prisma`.
- Hay además esquema/migraciones en `backend/prisma` según procesos del workspace backend.
- Evolución de datos: carpetas `prisma/migrations` y `backend/prisma/migrations`.

### Dominios de datos principales

- **Comercial**: deals, notas y documentos relacionados.
- **Operación**: sesiones, relaciones de sesión y comentarios.
- **Recursos**: formadores, salas, unidades móviles, productos, variantes.
- **Portal público**: tokens/enlaces para acceso externo y gestión de alumnos.
- **Control**: logs, reporting y datos de soporte operativo.

### Comandos de Prisma

```bash
npm run generate
npm run prisma:format
```

## 11) Integraciones externas

El ERP está preparado para operar con varios proveedores:

- **Pipedrive**: contexto comercial y sincronizaciones CRM.
- **AWS S3**: almacenamiento de determinados documentos/activos.
- **Google Drive**: gestión de documentación compartida.
- **OpenAI**: soporte en generación/mejora de contenido de informes.
- **WooCommerce**: acceso a catálogo/producto en procesos concretos.

Cuando se modifique una integración, revisar:

- Credenciales y variables de entorno implicadas.
- Contrato de datos recibido/enviado.
- Gestión de errores y fallback de negocio.

## 12) Variables de entorno

Crear un archivo `.env` en la raíz.

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

## 13) Puesta en marcha local

1. Instalar dependencias en raíz:

   ```bash
   npm install
   ```

2. Generar Prisma Client:

   ```bash
   npm run generate
   ```

3. Levantar frontend + functions con Netlify:

   ```bash
   npx netlify dev -p 8888
   ```

4. Abrir:

- App: `http://localhost:8888`
- API proxificada: `http://localhost:8888/api/*`

### Arranque aislado de frontend (opcional)

```bash
npm run dev --workspace frontend
```

## 14) Comandos útiles

Desde raíz:

- `npm run build` — build de frontend.
- `npm run test --workspace frontend` — tests unitarios/interfaz frontend.
- `npm run typecheck --workspace frontend` — chequeo de tipos frontend.
- `npm run typecheck:functions` — chequeo de tipos de funciones backend.
- `npm run prisma:format` — formato de esquema Prisma.
- `npm run prisma:prune` — limpieza de binarios Prisma para CI/Netlify.
- `npm run netlify:build` — pipeline de build para despliegue.

## 15) Flujo recomendado para cambios

1. Identificar el módulo funcional impactado.
2. Cambiar backend y validar contrato API.
3. Ajustar frontend en `features`/`pages` según corresponda.
4. Si hay cambios de datos, actualizar Prisma + migraciones.
5. Ejecutar checks (typecheck/tests/build mínimo).
6. Revisar permisos y casos de borde.
7. Documentar cambio en README/docs si altera comportamiento estructural.

## 16) Despliegue en Netlify

- Comando de referencia de build: `npm run netlify:build`.
- `netlify.toml` define redirects (incluyendo `/api/*`) y fallback SPA.
- `backend.toml` ajusta empaquetado/build del workspace backend.

## 17) Documentación funcional adicional

Para ampliar contexto funcional y de memoria:

- Mapa visual: `docs/mapa-funcionalidades-erp.md`.
- Memoria funcional extensa: `docs/memoria-funcional-erp-gep.md`.

---

Si incorporas un módulo nuevo (o cambias un flujo clave), actualiza este README para mantenerlo como fuente principal de onboarding técnico-funcional.
