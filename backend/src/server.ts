import express, { Request, Response, NextFunction } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { dealsRouter } from './routes/deals';
import { importDealFromPipedrive } from './services/importDeal';
import { prisma } from './prisma';

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
    if (!origin) return cb(null, true); // curl/healthchecks
    if (NODE_ENV === 'development' && (!rawOrigins || rawOrigins.length === 0)) {
      return cb(null, true);
    }
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

// Health y raíz
app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));
app.get('/', (_req: Request, res: Response) => res.redirect('/health'));

// Importación desde Pipedrive (sin include que rompa tipos)
app.post('/api/deals/import', async (req: Request, res: Response) => {
  try {
    const { dealId } = req.body;
    if (!dealId) return res.status(400).json({ ok: false, error: 'Falta dealId en el body' });

    const summary = await importDealFromPipedrive(String(dealId));

    // 1) Deal plano
    const deal = await prisma.deals.findUnique({
      where: { deal_id: String(dealId) },
    });

    // 2) Relaciones por separado (evita problemas de tipos con include)
    const [organization, person, products] = await Promise.all([
      deal?.org_id
        ? prisma.organizations.findUnique({ where: { org_id: String(deal.org_id) } })
        : Promise.resolve(null),
      deal?.person_id
        ? prisma.persons.findUnique({ where: { person_id: String(deal.person_id) } })
        : Promise.resolve(null),
      prisma.deal_products.findMany({
        where: { deal_id: String(dealId) },
        orderBy: { created_at: 'asc' },
      }),
    ]);

    const combined = deal
      ? { ...deal, organizations: organization, persons: person, deal_products: products }
      : null;

    return res.json({ ok: true, summary, deal: combined });
  } catch (err: any) {
    logger.error({ err }, 'Error en /api/deals/import');
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// Rutas de negocio
app.use('/api/deals', dealsRouter);

// Error handler
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
