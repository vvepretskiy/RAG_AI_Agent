import { Router } from 'express';
import { getEmbeddingMetrics } from '../agent';

const router = Router();

router.get('/', (_, res) => {
  res.json({
    status: 'ok',
    embeddingMetrics: getEmbeddingMetrics(),
  });
});

export default router;
