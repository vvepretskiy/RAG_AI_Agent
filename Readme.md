# RAG Agent

Retrieval-Augmented Generation (RAG) service that ingests PDF text, builds embeddings, and answers questions using local Ollama models.

## Features
- PDF ingestion with size guardrails
- Configurable chunking
- Embedding benchmark: plain vs gzip storage strategy
- Auto-selection mode based on byte savings and slowdown thresholds
- Trend analytics and recommendation endpoint
- Prometheus-compatible HTTP metrics

## Project Structure
- `src/index.ts`: app bootstrap and route registration
- `src/ingest.ts`: document loading, chunking, embedding pipeline
- `src/agent.ts`: agent orchestration and query execution
- `src/agent/embeddingAnalytics.ts`: benchmark policy, history trends, summary/recommendation
- `src/routes/*.ts`: API route handlers

## Requirements
- Node.js 20+
- Ollama running with both embedding and chat models available

## Install
```bash
npm install
```

## Environment
Example `.env`:

```dotenv
PORT=5010
NODE_ENV=development
OLLAMA_BASE_URL=http://localhost:11434
AGENT_MODEL=qwen3-coder:30b
EMBEDDING_MODEL=nomic-embed-text

CHUNK_SIZE=1000
CHUNK_OVERLAP=200
FILE_PATH=data/Vitalii_Vepretskyi_CV_en.pdf

EMBEDDING_BENCHMARK=true
EMBEDDING_STORAGE_MODE=plain
EMBEDDING_MODE_STRATEGY=auto
EMBEDDING_BENCHMARK_RUNS=3
EMBEDDING_AUTO_MIN_BYTES_SAVED=512
EMBEDDING_AUTO_MAX_SLOWDOWN_MS=30
EMBEDDING_HISTORY_LIMIT=30
```

## Run
```bash
# one-shot compile
npm run build:once

# start compiled server
npm start
```

Note: `npm run build` runs TypeScript in watch mode.

## Test
```bash
npm test
```

Tests cover benchmark decision and analytics behavior in `src/tests/embeddingAnalytics.test.ts`.

## API

### `POST /ask`
Request body:
```json
{ "question": "What technologies are listed in this CV?" }
```

Response:
```json
{ "answer": "..." }
```

### `GET /health`
Health plus latest embedding metrics payload.

### `GET /metrics`
Prometheus metrics.

### `GET /embedding-metrics`
Returns:
- `info`
- `summary` (size/time deltas + trends)
- `recommendation` (final mode + reason + confidence)
- `raw` (latest benchmark payload)

## Compression Strategy Notes

### Can we compress embedded vectors before saving?
Short answer: not directly with current `MemoryVectorStore` if you still need similarity search.

Why:
- Similarity search computes cosine distance over numeric vectors.
- If vectors are gzip-compressed bytes, you cannot search until you fully decompress back to float arrays.
- That removes most runtime benefit and adds CPU overhead per query.

### What works well in this project
- Keep runtime vectors as numeric arrays (plain) in memory for fast retrieval.
- Use gzip for chunk payload storage/transport metadata, not for active vector math.

### If persistent vector storage is needed
Use a vector DB with built-in compression/quantization (e.g., PQ/IVF, scalar quantization) rather than gzip over raw float arrays.
