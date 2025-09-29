import { Router } from 'express';
import { z } from 'zod';
import { importDealFromPipedrive } from '../services/importDeal';
import axios from 'axios';

const router = Router();

const importSchema = z.object({
  federalNumber: z.string().min(1, 'El número de deal es obligatorio')
});

router.post('/import', async (req, res, next) => {
  try {
    const { federalNumber } = importSchema.parse(req.body);
    const deal = await importDealFromPipedrive(federalNumber);
    res.json(deal);
  } catch (err: any) {
    if (err?.name === 'ZodError') {
      return res.status(400).json({ message: 'Datos inválidos', issues: err.errors });
    }
    if (typeof err?.message === 'string') {
      if (err.message.includes('El número de deal debe ser numérico')) {
        return res.status(400).json({ message: err.message });
      }
      if (err.message.startsWith('No existe el deal')) {
        return res.status(404).json({ message: err.message });
      }
    }
    if (axios.isAxiosError(err)) {
      const status = err.response?.status ?? 502;
      return res.status(status).json({
        message: 'Error llamando a Pipedrive',
        upstreamStatus: status,
        details: err.response?.data ?? null
      });
    }
    return next(err);
  }
});

export const dealsRouter = router;
