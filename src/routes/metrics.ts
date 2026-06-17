import { Router } from 'express';
import { metricsHandler } from '../metrics';

const router = Router();

router.get('/', metricsHandler);

export default router;
