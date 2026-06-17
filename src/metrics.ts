import { Request, Response, NextFunction } from 'express';
import client from 'prom-client';

client.collectDefaultMetrics();

// Metrics
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
});

const httpRequestsInProgress = new client.Gauge({
  name: 'http_requests_in_progress',
  help: 'Number of HTTP requests in progress',
  labelNames: ['method', 'route'] as const,
});

const httpRequestErrorsTotal = new client.Counter({
  name: 'http_request_errors_total',
  help: 'Total number of HTTP requests resulting in error (5xx)',
  labelNames: ['method', 'route', 'status'] as const,
});

// Helper to normalize route label to avoid high-cardinality
function routeLabel(req: Request): string {
  // prefer matched route path if available, otherwise fallback to baseUrl+path
  // if route path contains params, consider using route.path; express sets req.route when matched
  // Use '/unknown' fallback for unmatched
  // Note: for routers mounted at /ask, route will be '/' so use baseUrl + route.path
  const route = (req.route && (req.baseUrl ? `${req.baseUrl}${req.route.path}` : req.route.path)) || req.path || '/unknown';
  return route;
}

// Middleware
export default function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const method = req.method;
  const route = routeLabel(req);

  httpRequestsInProgress.inc({ method, route });

  const endTimer = httpRequestDurationSeconds.startTimer();

  res.on('finish', () => {
    const status = String(res.statusCode);
    httpRequestsTotal.inc({ method, route, status });
    endTimer({ method, route, status });
    httpRequestsInProgress.dec({ method, route });

    if (res.statusCode >= 500) {
      httpRequestErrorsTotal.inc({ method, route, status });
    }
  });

  next();
}

// /metrics handler
export async function metricsHandler(_req: Request, res: Response) {
  try {
    res.setHeader('Content-Type', client.register.contentType);
    const metrics = await client.register.metrics();
    res.end(metrics);
  } catch (err) {
    res.status(500).end(err instanceof Error ? err.message : String(err));
  }
}

// Export client for instrumentation elsewhere (e.g., LLM call counters)
export { client, httpRequestsTotal, httpRequestDurationSeconds, httpRequestsInProgress, httpRequestErrorsTotal };
