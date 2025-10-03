# ERP_GEP

ERP interno para planificación, visualización y gestión de formaciones procedentes de Pipedrive.  
Este proyecto integra **Frontend React** y **Backend vía Netlify Functions** con conexión a **Neon PostgreSQL** a través de **Prisma ORM**.

---

## 📦 Stack tecnológico

- **Frontend**: React + Vite + TypeScript + React-Bootstrap
- **Backend**: Netlify Functions (Node.js, TypeScript, AWS SDK v3)
- **DB**: PostgreSQL (Neon) gestionada con **Prisma ORM**
- **Infra: **Netlify** (build y deploy)

---

## 🔧 Configuración TypeScript

Se ha unificado la configuración TS para Functions en `backend/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "rootDir": "functions",
    "outDir": "functions-serve",
    "types": ["node"],
    "noEmit": true
  },
  "include": ["functions/**/*.ts"],
  "exclude": ["node_modules", "functions-serve", "../frontend", "../dist", "../build", "../.next"]
}
