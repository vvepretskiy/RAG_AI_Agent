import { EmbeddingBenchmarkReport, EmbeddingMode, EmbeddingRunReport } from "../ingest";

type EmbeddingModeStrategy = 'manual' | 'auto';

interface EmbeddingRecommendation {
  finalMode: EmbeddingMode;
  reason: string;
  confidence: 'low' | 'medium' | 'high';
}

interface EmbeddingHistoryTrends {
  sampleCount: number;
  historyLimit: number;
  medianStorageSavedBytes: number;
  p95StorageSavedBytes: number;
  medianTotalTimeDeltaMs: number;
  p95AbsTotalTimeDeltaMs: number;
  gzipSelectionRate: number;
}

interface EmbeddingSummaryResponse {
  info: {
    benchmarkEnabled: boolean;
    selectedMode: EmbeddingMode | null;
    generatedAt: string | null;
  };
  summary: {
    storageSavedBytes?: number;
    storageSavedPercent?: number;
    totalTimeDeltaMs?: number;
    trends?: EmbeddingHistoryTrends;
    notes: string[];
  };
  recommendation: EmbeddingRecommendation;
  raw: EmbeddingRunReport | EmbeddingBenchmarkReport | null;
}

type BenchmarkHistoryEntry = {
  timestamp: string;
  selectedMode: EmbeddingMode;
  storageSavedBytes: number;
  storageSavedPercent: number;
  totalTimeDeltaMs: number;
};

const benchmarkHistory: BenchmarkHistoryEntry[] = [];

const average = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const toInt = (value: number): number => Math.round(value);

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const base = Math.floor(position);
  const rest = position - base;
  const lower = sorted[base];
  const upper = sorted[base + 1] ?? sorted[base];
  return lower + rest * (upper - lower);
};

const median = (values: number[]): number => percentile(values, 0.5);

const getHistoryLimit = (): number => {
  const parsed = parseInt(process.env.EMBEDDING_HISTORY_LIMIT ?? '30', 10);
  return Number.isNaN(parsed) ? 30 : Math.max(1, parsed);
};

export const getEmbeddingStrategy = (): EmbeddingModeStrategy =>
  process.env.EMBEDDING_MODE_STRATEGY === 'auto' ? 'auto' : 'manual';

export const getPreferredEmbeddingMode = (): EmbeddingMode =>
  process.env.EMBEDDING_STORAGE_MODE === 'plain' ? 'plain' : 'gzip';

export const getBenchmarkEnabled = (): boolean => process.env.EMBEDDING_BENCHMARK === 'true';

export const getBenchmarkRuns = (): number => {
  const parsed = parseInt(process.env.EMBEDDING_BENCHMARK_RUNS ?? '3', 10);
  return Number.isNaN(parsed) ? 3 : Math.max(1, parsed);
};

export const getAutoMinBytesSaved = (): number => {
  const parsed = parseInt(process.env.EMBEDDING_AUTO_MIN_BYTES_SAVED ?? '512', 10);
  return Number.isNaN(parsed) ? 512 : Math.max(0, parsed);
};

export const getAutoMaxSlowdownMs = (): number => {
  const parsed = Number(process.env.EMBEDDING_AUTO_MAX_SLOWDOWN_MS ?? '30');
  return Number.isNaN(parsed) ? 30 : parsed;
};

const averageRun = (runs: EmbeddingRunReport[]): EmbeddingRunReport => {
  const first = runs[0];
  return {
    mode: first.mode,
    generatedAt: new Date().toISOString(),
    timingsMs: {
      total: Number(average(runs.map((run) => run.timingsMs.total)).toFixed(3)),
      loadPdf: Number(average(runs.map((run) => run.timingsMs.loadPdf)).toFixed(3)),
      split: Number(average(runs.map((run) => run.timingsMs.split)).toFixed(3)),
      prepareStorageDocs: Number(average(runs.map((run) => run.timingsMs.prepareStorageDocs)).toFixed(3)),
      prepareEmbeddingDocs: Number(average(runs.map((run) => run.timingsMs.prepareEmbeddingDocs)).toFixed(3)),
      embedDocuments: Number(average(runs.map((run) => run.timingsMs.embedDocuments)).toFixed(3)),
      indexVectors: Number(average(runs.map((run) => run.timingsMs.indexVectors)).toFixed(3)),
    },
    sizesBytes: {
      sourceText: toInt(average(runs.map((run) => run.sizesBytes.sourceText))),
      storedChunkPayloadTotal: toInt(average(runs.map((run) => run.sizesBytes.storedChunkPayloadTotal))),
      embeddingInputTotal: toInt(average(runs.map((run) => run.sizesBytes.embeddingInputTotal))),
      vectorFloat32Total: toInt(average(runs.map((run) => run.sizesBytes.vectorFloat32Total))),
    },
    counts: {
      chunks: toInt(average(runs.map((run) => run.counts.chunks))),
      vectors: toInt(average(runs.map((run) => run.counts.vectors))),
      dimensions: toInt(average(runs.map((run) => run.counts.dimensions))),
    },
    compression: {
      ratioStoredToPlain: Number(average(runs.map((run) => run.compression.ratioStoredToPlain)).toFixed(4)),
    },
  };
};

export const averageBenchmark = (
  reports: EmbeddingBenchmarkReport[],
  preferredMode: EmbeddingMode,
): EmbeddingBenchmarkReport => {
  return {
    generatedAt: new Date().toISOString(),
    preferredMode,
    selectedMode: preferredMode,
    plain: averageRun(reports.map((report) => report.plain)),
    gzip: averageRun(reports.map((report) => report.gzip)),
  };
};

export const chooseBestMode = (
  report: EmbeddingBenchmarkReport,
  minBytesSaved: number,
  maxSlowdownMs: number,
): EmbeddingMode => {
  const bytesSaved = report.plain.sizesBytes.storedChunkPayloadTotal - report.gzip.sizesBytes.storedChunkPayloadTotal;
  const gzipSlowdownMs = report.gzip.timingsMs.total - report.plain.timingsMs.total;
  const gzipPasses = bytesSaved >= minBytesSaved && gzipSlowdownMs <= maxSlowdownMs;
  return gzipPasses ? 'gzip' : 'plain';
};

export const updateBenchmarkHistory = (report: EmbeddingBenchmarkReport) => {
  const plainBytes = report.plain.sizesBytes.storedChunkPayloadTotal;
  const gzipBytes = report.gzip.sizesBytes.storedChunkPayloadTotal;
  const storageSavedBytes = plainBytes - gzipBytes;
  const storageSavedPercent = plainBytes === 0 ? 0 : Number(((storageSavedBytes / plainBytes) * 100).toFixed(2));
  const totalTimeDeltaMs = Number((report.plain.timingsMs.total - report.gzip.timingsMs.total).toFixed(3));

  benchmarkHistory.push({
    timestamp: new Date().toISOString(),
    selectedMode: report.selectedMode,
    storageSavedBytes,
    storageSavedPercent,
    totalTimeDeltaMs,
  });

  const historyLimit = getHistoryLimit();
  if (benchmarkHistory.length > historyLimit) {
    benchmarkHistory.splice(0, benchmarkHistory.length - historyLimit);
  }
};

const isBenchmarkReport = (
  value: EmbeddingRunReport | EmbeddingBenchmarkReport | null,
): value is EmbeddingBenchmarkReport => {
  return !!value && 'plain' in value && 'gzip' in value;
};

const getHistoryTrends = (): EmbeddingHistoryTrends => {
  const sampleCount = benchmarkHistory.length;
  const historyLimit = getHistoryLimit();
  if (sampleCount === 0) {
    return {
      sampleCount,
      historyLimit,
      medianStorageSavedBytes: 0,
      p95StorageSavedBytes: 0,
      medianTotalTimeDeltaMs: 0,
      p95AbsTotalTimeDeltaMs: 0,
      gzipSelectionRate: 0,
    };
  }

  const storageSavedValues = benchmarkHistory.map((item) => item.storageSavedBytes);
  const deltaValues = benchmarkHistory.map((item) => item.totalTimeDeltaMs);
  const absDeltaValues = deltaValues.map((value) => Math.abs(value));
  const gzipCount = benchmarkHistory.filter((item) => item.selectedMode === 'gzip').length;

  return {
    sampleCount,
    historyLimit,
    medianStorageSavedBytes: Number(median(storageSavedValues).toFixed(2)),
    p95StorageSavedBytes: Number(percentile(storageSavedValues, 0.95).toFixed(2)),
    medianTotalTimeDeltaMs: Number(median(deltaValues).toFixed(3)),
    p95AbsTotalTimeDeltaMs: Number(percentile(absDeltaValues, 0.95).toFixed(3)),
    gzipSelectionRate: Number((gzipCount / sampleCount).toFixed(3)),
  };
};

export const getEmbeddingSummary = (
  embeddingMetrics: EmbeddingRunReport | EmbeddingBenchmarkReport | null,
): EmbeddingSummaryResponse => {
  if (!embeddingMetrics) {
    return {
      info: {
        benchmarkEnabled: getBenchmarkEnabled(),
        selectedMode: null,
        generatedAt: null,
      },
      summary: {
        notes: ['Embedding metrics not available yet. Initialize agent first.'],
      },
      recommendation: {
        finalMode: getPreferredEmbeddingMode(),
        reason: 'No benchmark data yet. Using configured storage mode.',
        confidence: 'low',
      },
      raw: null,
    };
  }

  if (!isBenchmarkReport(embeddingMetrics)) {
    return {
      info: {
        benchmarkEnabled: false,
        selectedMode: embeddingMetrics.mode,
        generatedAt: embeddingMetrics.generatedAt,
      },
      summary: {
        notes: [
          'Single-mode run only. Enable EMBEDDING_BENCHMARK=true for side-by-side comparison.',
          `Current mode: ${embeddingMetrics.mode}`,
        ],
      },
      recommendation: {
        finalMode: embeddingMetrics.mode,
        reason: 'Only one mode was measured, so recommendation follows measured mode.',
        confidence: 'low',
      },
      raw: embeddingMetrics,
    };
  }

  const report = embeddingMetrics;
  const plainBytes = report.plain.sizesBytes.storedChunkPayloadTotal;
  const gzipBytes = report.gzip.sizesBytes.storedChunkPayloadTotal;
  const storageSavedBytes = plainBytes - gzipBytes;
  const storageSavedPercent = plainBytes === 0 ? 0 : Number(((storageSavedBytes / plainBytes) * 100).toFixed(2));

  const plainTotalMs = report.plain.timingsMs.total;
  const gzipTotalMs = report.gzip.timingsMs.total;
  const totalTimeDeltaMs = Number((plainTotalMs - gzipTotalMs).toFixed(3));
  const gzipSlowdownMs = Number((gzipTotalMs - plainTotalMs).toFixed(3));

  const minBytesSaved = getAutoMinBytesSaved();
  const maxSlowdownMs = getAutoMaxSlowdownMs();

  const notes: string[] = [];
  const trends = getHistoryTrends();
  notes.push(`Storage payload: plain=${plainBytes} bytes, gzip=${gzipBytes} bytes.`);
  notes.push('Embedding input bytes remain equal across modes when text is decompressed before embedding.');

  const finalMode = chooseBestMode(report, minBytesSaved, maxSlowdownMs);
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  let reason = '';

  if (finalMode === 'gzip') {
    reason = `Gzip met thresholds: saved ${storageSavedBytes} bytes (${storageSavedPercent}%) with slowdown ${Math.max(0, gzipSlowdownMs)} ms.`;
    confidence = storageSavedBytes > minBytesSaved * 2 ? 'high' : 'medium';
  } else {
    reason = `Plain selected because gzip did not meet thresholds (minBytesSaved=${minBytesSaved}, maxSlowdownMs=${maxSlowdownMs}).`;
    confidence = 'medium';
  }

  notes.push(`Decision thresholds: minBytesSaved=${minBytesSaved}, maxSlowdownMs=${maxSlowdownMs}.`);
  notes.push(`History trends: samples=${trends.sampleCount}, medianStorageSavedBytes=${trends.medianStorageSavedBytes}, p95AbsTotalTimeDeltaMs=${trends.p95AbsTotalTimeDeltaMs}.`);

  if (Math.abs(totalTimeDeltaMs) > 30) {
    const speedWinner = totalTimeDeltaMs > 0 ? 'gzip' : 'plain';
    notes.push(`Total runtime winner in this run: ${speedWinner} (${Math.abs(totalTimeDeltaMs)} ms faster).`);
    notes.push('Runtime differences can vary by file-read and model latency; compare multiple runs for stable conclusions.');
  } else {
    notes.push('Total runtime difference is small in this run.');
  }

  return {
    info: {
      benchmarkEnabled: true,
      selectedMode: report.selectedMode,
      generatedAt: report.generatedAt,
    },
    summary: {
      storageSavedBytes,
      storageSavedPercent,
      totalTimeDeltaMs,
      trends,
      notes,
    },
    recommendation: {
      finalMode,
      reason,
      confidence,
    },
    raw: report,
  };
};

export const __internal = {
  percentile,
  median,
  getHistoryLimit,
  getBenchmarkRuns,
  getAutoMinBytesSaved,
  getAutoMaxSlowdownMs,
};

export type { EmbeddingSummaryResponse, EmbeddingHistoryTrends, EmbeddingRecommendation };
