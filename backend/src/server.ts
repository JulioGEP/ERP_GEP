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
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(request) {
        return { method: request.method, url: request.url };
      }
    }
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/deals', dealsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(err, 'Unhandled error');
  res.status(500).json({ message: 'Error interno del servidor' });
});

app.listen(env.PORT, () => {
  logger.info(`Servidor escuchando en http://localhost:${env.PORT}`);
});
