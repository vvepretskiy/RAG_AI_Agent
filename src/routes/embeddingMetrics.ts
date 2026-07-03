import { Router } from 'express';
import { getEmbeddingSummary } from '../agent';

const router = Router();

router.get('/', (_req, res) => {
  const result = getEmbeddingSummary();
  res.json(result);
});

export default router;
