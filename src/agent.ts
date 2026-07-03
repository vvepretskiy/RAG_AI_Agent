import { benchmarkEmbeddingPipelines, EmbeddingBenchmarkReport, EmbeddingRunReport, runEmbeddingPipeline } from "./ingest";
import { ChatOllama } from "@langchain/ollama";
import { RetrievalQAChain } from "@langchain/classic/chains";
import { gunzipSync } from "zlib";
import {
  averageBenchmark,
  chooseBestMode,
  getAutoMaxSlowdownMs,
  getAutoMinBytesSaved,
  getBenchmarkEnabled,
  getBenchmarkRuns,
  getEmbeddingStrategy,
  getEmbeddingSummary as buildEmbeddingSummary,
  getPreferredEmbeddingMode,
  updateBenchmarkHistory,
} from "./agent/embeddingAnalytics";

let qaChain: RetrievalQAChain | null = null;
let embeddingMetrics: EmbeddingRunReport | EmbeddingBenchmarkReport | null = null;

const maybeDecodeGzipBase64 = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith("gz:")) {
    return value;
  }

  const base64 = trimmed.slice(3);
  return gunzipSync(Buffer.from(base64, "base64")).toString("utf-8");
};

export const initAgent = async () => {
  console.log("Initializing agent...");

  const strategy = getEmbeddingStrategy();
  const preferredMode = getPreferredEmbeddingMode();
  const benchmarkEnabled = getBenchmarkEnabled();
  const benchmarkRuns = getBenchmarkRuns();
  const autoMinBytesSaved = getAutoMinBytesSaved();
  const autoMaxSlowdownMs = getAutoMaxSlowdownMs();

  let vectorStore;

  if (strategy === "auto") {
    const reports: EmbeddingBenchmarkReport[] = [];
    for (let i = 0; i < benchmarkRuns; i += 1) {
      const result = await benchmarkEmbeddingPipelines(preferredMode);
      reports.push(result.report);
    }

    const averagedReport = averageBenchmark(reports, preferredMode);
    const finalMode = chooseBestMode(averagedReport, autoMinBytesSaved, autoMaxSlowdownMs);
    const finalRun = await runEmbeddingPipeline(finalMode);

    averagedReport.selectedMode = finalMode;
    embeddingMetrics = averagedReport;
    updateBenchmarkHistory(averagedReport);
    vectorStore = finalRun.vectorStore;

    console.info(
      "Embedding auto-selection report:",
      JSON.stringify(
        {
          strategy,
          benchmarkRuns,
          thresholds: {
            minBytesSaved: autoMinBytesSaved,
            maxSlowdownMs: autoMaxSlowdownMs,
          },
          selectedMode: finalMode,
          benchmark: averagedReport,
        },
        null,
        2,
      ),
    );
  } else if (benchmarkEnabled) {
    const reports: EmbeddingBenchmarkReport[] = [];
    for (let i = 0; i < benchmarkRuns; i += 1) {
      const result = await benchmarkEmbeddingPipelines(preferredMode);
      reports.push(result.report);
    }

    const averagedReport = averageBenchmark(reports, preferredMode);
    averagedReport.selectedMode = preferredMode;
    const finalRun = await runEmbeddingPipeline(preferredMode);

    vectorStore = finalRun.vectorStore;
    embeddingMetrics = averagedReport;
    updateBenchmarkHistory(averagedReport);

    console.info(
      "Embedding benchmark report:",
      JSON.stringify(
        {
          benchmarkRuns,
          report: averagedReport,
        },
        null,
        2,
      ),
    );
  } else {
    const result = await runEmbeddingPipeline(preferredMode);
    vectorStore = result.vectorStore;
    embeddingMetrics = result.report;
    console.info("Embedding pipeline report:", JSON.stringify(result.report, null, 2));
  }

  const retriever = vectorStore.asRetriever();
  const model = new ChatOllama({
    model: process.env.AGENT_MODEL,
    temperature: 0,
    baseUrl: process.env.OLLAMA_BASE_URL,
  });

  qaChain = RetrievalQAChain.fromLLM(model, retriever);
};

export const askAgent = async (question: string) => {
  if (!qaChain) {
    throw new Error("Agent not initialized. Please call initAgent() first.");
  }

  console.log("Asking agent:", question);
  const decodedQuestion = maybeDecodeGzipBase64(question);

  try {
    let answer;

    if (!process.env.TIMEOUT_RESPONSE) {
      answer = await qaChain.invoke({ query: decodedQuestion });
    } else {
      const timeoutMs = parseInt(process.env.TIMEOUT_RESPONSE, 10);
      const controller = new AbortController();

      const answerPromise = qaChain.invoke(
        { query: decodedQuestion },
        { callbacks: [], signal: controller.signal },
      );

      const timeout = (ms: number) =>
        new Promise<never>((_, rej) =>
          setTimeout(() => {
            controller.abort();
            rej(new Error("invoke timeout"));
          }, ms),
        );

      answer = (await Promise.race([answerPromise, timeout(timeoutMs)])) as { text?: string };
    }

    const text = answer?.text ?? String(answer);
    console.log("Answer:", text);
    return text;
  } catch (err) {
    console.error("askAgent error:", err);
    throw err;
  }
};

export const getEmbeddingMetrics = () => embeddingMetrics;

export const getEmbeddingSummary = () => buildEmbeddingSummary(embeddingMetrics);

export const __internal = {
  setQaChainForTests: (chain: RetrievalQAChain | null) => {
    qaChain = chain;
  },
  resetForTests: () => {
    qaChain = null;
    embeddingMetrics = null;
  },
};
