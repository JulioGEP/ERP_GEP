# Mapa visual de funcionalidades — ERP GEP

Este documento está pensado para usarlo como base de una **memoria funcional**. Incluye una vista global y una vista de relaciones entre módulos.

## 1) Mapa global (mindmap)

```mermaid
mindmap
  root((ERP GEP))
    Presupuestos y CRM
      Deals y pipeline
      Notas del deal
      Documentos de oportunidad
      Integración Pipedrive
    Planificación y Calendario
      Sesiones formativas
      Variantes de calendario
      Comentarios de sesión
      Documentos de sesión
      Confirmaciones de recursos
    Recursos
      Formadores
      Salas
      Unidades móviles
      Productos y variantes
      Relaciones entre variantes
    Portal público de alumnos
      Enlaces públicos con token
      Alta / edición / baja de alumnos
      Límite de peticiones
    Informes y certificados
      Generación de informes
      Mejora asistida por IA
      Subida y prefilling
      Certificados
      Panel de formadores
    Reporting y control
      Auditoría de eventos
      Logs operativos
      Horas de formadores
      Control horario
      Costes extra
    Plataforma transversal
      Autenticación y permisos
      API serverless (Netlify Functions)
      Frontend React (panel interno)
      Base de datos PostgreSQL + Prisma
      Integraciones externas
        AWS S3
        Google Drive
        OpenAI
        WooCommerce
```

## 2) Mapa de relaciones entre módulos (flujo operativo)

```mermaid
flowchart LR
  A[Presupuestos/CRM] --> B[Planificación de sesiones]
  B --> C[Asignación de recursos]
  C --> D[Portal público de alumnos]
  B --> E[Informes y certificados]
  C --> E
  E --> F[Panel de formadores]
  A --> G[Reporting]
  B --> G
  C --> G
  D --> G
  E --> G

  H[Autenticación y permisos] --> A
  H --> B
  H --> C
  H --> D
  H --> E
  H --> F
  H --> G

  I[Integraciones externas] --> A
  I --> E
  I --> G

  J[PostgreSQL + Prisma] --- A
  J --- B
  J --- C
  J --- D
  J --- E
  J --- G
```

## 3) Leyenda breve para la memoria

- **Origen del trabajo**: normalmente inicia en **Presupuestos/CRM** (oportunidad comercial).
- **Ejecución operativa**: pasa por **Planificación** + **Recursos**.
- **Interacción externa**: el alumno participa vía **Portal público**.
- **Salida documental**: se genera en **Informes y certificados**.
- **Trazabilidad y control**: todo converge en **Reporting** y eventos de auditoría.

## 4) Guion sugerido para redactar la memoria

1. **Contexto y objetivo del ERP**.
2. **Descripción de módulos** (usar el mindmap como índice).
3. **Flujo end-to-end** de una acción real (de presupuesto a informe).
4. **Gobierno del dato** (auth, roles, permisos y base de datos).
5. **Integraciones externas y valor aportado**.
6. **KPIs y reporting para la toma de decisiones**.

---

Este mapa sirve como soporte visual de la memoria completa disponible en `docs/memoria-funcional-erp-gep.md`.
