import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { dealsRouter } from './routes/deals';

const logger = pino({
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  level: env.NODE_ENV === 'development' ? 'debug' : 'info'
});

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.use('/api/deals', dealsRouter);

// Error handler con detalle en dev
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');

  if (env.NODE_ENV === 'development') {
    const status = err?.statusCode || err?.status || 500;
    return res.status(status).json({
      message: 'Error interno del servidor',
      error: String(err?.message || err),
      details: err?.response?.data || undefined,
      stack: err?.stack || undefined
    });
  }

  res.status(500).json({ message: 'Error interno del servidor' });
});

app.listen(env.PORT, () => {
  logger.info(`Servidor escuchando en http://localhost:${env.PORT}`);
});
