import test from "node:test";
import assert from "node:assert/strict";
import {
  __internal,
  averageBenchmark,
  chooseBestMode,
  getEmbeddingSummary,
  updateBenchmarkHistory,
} from "../agent/embeddingAnalytics";
import { EmbeddingBenchmarkReport, EmbeddingRunReport } from "../ingest";

const makeRun = (
  mode: "plain" | "gzip",
  totalMs: number,
  storedBytes: number,
): EmbeddingRunReport => ({
  mode,
  generatedAt: new Date().toISOString(),
  timingsMs: {
    total: totalMs,
    loadPdf: 10,
    split: 1,
    prepareStorageDocs: 1,
    prepareEmbeddingDocs: 1,
    embedDocuments: totalMs - 13,
    indexVectors: 0,
  },
  sizesBytes: {
    sourceText: 5000,
    storedChunkPayloadTotal: storedBytes,
    embeddingInputTotal: 5600,
    vectorFloat32Total: 30000,
  },
  counts: {
    chunks: 10,
    vectors: 10,
    dimensions: 768,
  },
  compression: {
    ratioStoredToPlain: mode === "plain" ? 1 : 0.84,
  },
});

const makeBenchmark = (
  plainTotal: number,
  gzipTotal: number,
  plainBytes = 5555,
  gzipBytes = 4671,
): EmbeddingBenchmarkReport => ({
  generatedAt: new Date().toISOString(),
  preferredMode: "plain",
  selectedMode: "plain",
  plain: makeRun("plain", plainTotal, plainBytes),
  gzip: makeRun("gzip", gzipTotal, gzipBytes),
});

test("chooseBestMode selects gzip when thresholds pass", () => {
  const report = makeBenchmark(220, 230, 5555, 4671);
  const mode = chooseBestMode(report, 500, 20);
  assert.equal(mode, "gzip");
});

test("chooseBestMode selects plain when gzip slowdown exceeds threshold", () => {
  const report = makeBenchmark(220, 270, 5555, 4671);
  const mode = chooseBestMode(report, 500, 20);
  assert.equal(mode, "plain");
});

test("averageBenchmark computes stable averages", () => {
  const r1 = makeBenchmark(200, 210, 5600, 4700);
  const r2 = makeBenchmark(220, 230, 5500, 4600);
  const avg = averageBenchmark([r1, r2], "plain");

  assert.equal(avg.plain.timingsMs.total, 210);
  assert.equal(avg.gzip.timingsMs.total, 220);
  assert.equal(avg.plain.sizesBytes.storedChunkPayloadTotal, 5550);
  assert.equal(avg.gzip.sizesBytes.storedChunkPayloadTotal, 4650);
});

test("getEmbeddingSummary includes trends after history updates", () => {
  process.env.EMBEDDING_AUTO_MIN_BYTES_SAVED = "100";
  process.env.EMBEDDING_AUTO_MAX_SLOWDOWN_MS = "40";
  process.env.EMBEDDING_HISTORY_LIMIT = "30";

  const report = makeBenchmark(240, 235, 5555, 4671);
  report.selectedMode = "gzip";
  updateBenchmarkHistory(report);

  const summary = getEmbeddingSummary(report);
  assert.ok(summary.summary.trends);
  assert.equal(summary.summary.trends?.sampleCount > 0, true);
  assert.equal(summary.recommendation.finalMode, "gzip");
});

test("internal percentile helper returns expected median", () => {
  const result = __internal.percentile([1, 2, 3, 4, 5], 0.5);
  assert.equal(result, 3);
});
