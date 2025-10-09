
---

## 🗄️ Base de datos

**Proveedor:** Neon (PostgreSQL)  
**Gestor:** Prisma ORM

**Tablas principales:**
- `Organizations`
- `Persons`
- `Deals`
- `Notes`
- `Documents`
- `Trainers`
- `UnidadesMoviles`

**Convenciones de datos:**

| Campo original | Alias en ERP | Descripción |
|----------------|--------------|-------------|
| deal_org_id | org_id | Identificador de la organización |
| deal_direction | training_address | Dirección de formación |
| Sede | sede_label | Sede operativa |
| CAES | caes_label | Marcador de centro CAES |
| FUNDAE | fundae_label | Bonificación FUNDAE |
| Hotel_Night | hotel_label | Necesidad de hotel |
| deal_files | documents[] | Lista de documentos vinculados |

---

## 🔗 Integraciones externas

### Pipedrive API v1
- Sincronización 1:1 de deals, organizaciones y personas.  
- Actualización en tiempo real vía Netlify Function `/deals/import`.  
- Transformación de campos y normalización antes de insertar en Neon.

### AWS S3
- Gestión de documentos con URLs firmadas (presigned URLs).  
- Metadatos guardados en tabla `deal_files` (`file_name`, `file_url`, `storage_key`).

---

## 🔐 Autenticación y control de acceso

- Variable de entorno `ALLOWED_EMAIL_DOMAIN` para restringir el dominio de acceso.  
- Login inicial por email/password (con futura opción de magic link o SSO).

---

## ⚙️ Flujo de desarrollo

1. Clonar el repo monorepo.  
2. Crear rama: `fix/<nombre>` o `feature/<nombre>`.  
3. Hacer commit + push.  
4. Crear PR con:
   ```bash
   gh pr create
   gh pr merge
💬 API disponible
Endpoint	Método	Descripción
/deals/import	POST	Importa deal desde Pipedrive
/deals?noSessions=true	GET	Lista deals sin sesiones
/deals/:dealId	GET	Detalle de un deal
/deals/:dealId	PATCH	Actualiza campos operativos (sede_label, hours, alumnos, etc.)
/deal_documents	POST	Subida de documento con URL firmada
/health	GET	Healthcheck del sistema
🧭 Roadmap inmediato

Sincronización completa de documentos desde Pipedrive.

Previsualización de documentos sin login Pipedrive.

Subida directa desde el popup (guardar file_name y storage_key).

Panel de sesiones vinculadas a cada presupuesto.

Integración de WebSocket/SSE para actualizaciones en vivo.

Dashboard de control de cargas y KPI.

🧑‍💻 Mantenimiento y estilo de código

Linter: ESLint + Prettier.

No versionar .env.

Formato de commits: Conventional Commits.

Convenciones de branches: feature/*, fix/*.

Documentación viva en README.md.
