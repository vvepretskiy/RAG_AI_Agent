import express from 'express';
import dotenv from 'dotenv';
import logger from './logger';
import { initAgent } from './agent';
import askRoute from './routes/ask';
import healthRoute from './routes/health';
import metricsMiddleware from './metrics'; // metrics.ts should export default middleware and metricsHandler
import metricsRoute from './routes/metrics';

dotenv.config();
logger.init();

const app = express();
app.use(express.json());

// metrics middleware (tracks in-progress, duration, counts)
if (metricsMiddleware) app.use(metricsMiddleware);

// Routes
app.use('/ask', askRoute);
app.use('/health', healthRoute);
app.use('/metrics', metricsRoute);

// Central error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err && typeof err === 'object' && 'message' in err ? (err as any).message : String(err);
  console.error({ err }, 'Unhandled error');
  res.status(500).json({ error: message ?? 'Internal Server Error' });
});

const PORT = process.env.PORT ?? 3000;

const server = app.listen(PORT, async () => {
  console.info(`Server listening on port ${PORT}`);
  try {
    await initAgent();
    console.info('Agent initialized');
  } catch (err) {
    console.error({ err }, 'initAgent failed');
    process.exit(1);
  }
});

// graceful shutdown
const shutdown = async () => {
  console.info('Shutting down...');
  server.close(() => {
    console.info('HTTP server closed');
    process.exit(0);
  });
  // timeout forced exit
  setTimeout(() => {
    console.warn('Forcing shutdown');
    process.exit(1);
  }, 30_000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
