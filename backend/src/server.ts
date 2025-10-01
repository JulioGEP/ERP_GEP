import express, { Request, Response, NextFunction } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { dealsRouter } from './routes/deals';

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const PORT = Number(process.env.PORT ?? 4000);

// Admite varios orígenes separados por coma (Netlify + localhost)
const rawOrigins =
  process.env.CORS_ORIGIN?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) || null;

// Config CORS estricta en prod; permisiva en dev si no hay CORS_ORIGIN
const corsOptions: CorsOptions = {
  origin: (origin, cb) => {
    // Requests sin origin (curl, healthchecks) se permiten
    if (!origin) return cb(null, true);

    // En dev, si no especificaste CORS_ORIGIN, permite todo
    if (NODE_ENV === 'development' && (!rawOrigins || rawOrigins.length === 0)) {
      return cb(null, true);
    }

    // En prod (o si configuraste CORS_ORIGIN), exige coincidencia exacta
    if (rawOrigins && rawOrigins.includes(origin)) {
      return cb(null, true);
    }

    return cb(new Error(`CORS: Origin no permitido: ${origin}`));
  },
  credentials: true,
};

const logger = pino({
  transport: NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  level: NODE_ENV === 'development' ? 'debug' : 'info',
});

const app = express();

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());
app.use(pinoHttp({ logger }));

// Health y raíz (para evitar "Cannot GET /" en navegador)
app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));
app.get('/', (_req: Request, res: Response) => res.redirect('/health'));

// Rutas de negocio
app.use('/api/deals', dealsRouter);

// Error handler con detalle en dev
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  if (NODE_ENV === 'development') {
    const status = err?.statusCode || err?.status || 500;
    return res.status(status).json({
      message: 'Error interno del servidor',
      error: String(err?.message || err),
      details: err?.response?.data || undefined,
      stack: err?.stack || undefined,
    });
  }
  res.status(500).json({ message: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  logger.info(`Servidor escuchando en http://localhost:${PORT}`);
});
