import { Router } from 'express';
import { z } from 'zod';
import { importDealFromPipedrive } from '../services/importDeal';

const router = Router();

const importSchema = z.object({
  federalNumber: z.string().min(3, 'El número federal debe tener al menos 3 caracteres')
});

router.post('/import', async (req, res, next) => {
  try {
    const payload = importSchema.parse(req.body);
    const deal = await importDealFromPipedrive(payload.federalNumber);
    res.json(deal);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: 'Datos inválidos', issues: error.errors });
    }
    return next(error);
  }
});

export const dealsRouter = router;
