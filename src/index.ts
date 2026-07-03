import express from 'express';
import dotenv from 'dotenv';
import logger from './logger';
import { initAgent } from './agent';
import askRoute from './routes/ask';
import healthRoute from './routes/health';
import metricsMiddleware from './metrics'; // metrics.ts should export default middleware and metricsHandler
import metricsRoute from './routes/metrics';
import embeddingMetricsRoute from './routes/embeddingMetrics';

dotenv.config();
logger.init();

function isErrorWithMessage(err: unknown): err is { message: string } {
  return typeof err === 'object' && err !== null && 'message' in err && typeof (err as any).message === 'string';
}
function getErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (isErrorWithMessage(err)) return err.message;
  return String(err ?? 'Unknown error');
}

const app = express();
app.use(express.json());

// metrics middleware (tracks in-progress, duration, counts)
if (metricsMiddleware) app.use(metricsMiddleware);

// Routes
app.use('/ask', askRoute);
app.use('/health', healthRoute);
app.use('/metrics', metricsRoute);
app.use('/embedding-metrics', embeddingMetricsRoute);

// Central error handler
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = getErrorMessage(err);
  console.error('Unhandled error:', message);
  res.status(500).json({ error: message });
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
