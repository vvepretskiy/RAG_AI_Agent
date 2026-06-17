# Project Skills & AI Context

This file provides technical context for AI agents working on this repository.

## Core Capabilities
- **Skill: Node.js/Express API**: Implementation of RESTful endpoints with centralized error handling and Prometheus instrumentation.
- **Skill: RAG (Retrieval-Augmented Generation)**: Orchestration of document ingestion, vector storage, and similarity-based retrieval using LangChain.
- **Skill: Local LLM Integration**: Interface for Ollama services providing embeddings and chat completion capabilities.
- **Skill: Observability**: Integrated metrics collection for request duration, error rates, and saturation.

## Infrastructure Requirements
- **Ollama**: Must be running locally or reachable via `OLLAMA_BASE_URL`.
- **Models**: Requires an LLM for generation (`AGENT_MODEL`) and an embedding model (`EMBEDDING_MODEL`).
- **Persistence**: Current implementation uses an in-memory vector store. Restarts will trigger re-ingestion of the PDF.

## Operational Knowledge
- **Entry Point**: `src/index.ts` handles server lifecycle and agent initialization.
- **Graceful Shutdown**: Listens for `SIGINT`/`SIGTERM` to close the server and force exit after 30 seconds if stuck.
- **Timeout Logic**: The `/ask` endpoint uses `AbortController` to cancel LLM requests if they exceed the `TIMEOUT_RESPONSE` threshold.

## Code Conventions
- Use `logger.info/error` instead of `console.log` for consistent output.
- Always use the `getErrorMessage` helper in catch blocks to ensure type-safe error reporting.
- Environment variables are mandatory for model configuration; the app will fail fast at startup if initialization fails.

## Known Constraints
- PDF ingestion is limited to 5MB by default (`MAX_BYTES` in `ingest.ts`).
- Memory usage will scale with the size of the ingested document since the vector store is non-persistent.

## Development Workflow for AI
- **Code Style**: Prefer functional programming patterns and explicit type definitions for all function returns.
- **Testing**: Always check `src/routes/health.ts` to ensure service availability logic is maintained when modifying the server lifecycle.
- **Dependencies**: Use `ChatOllama` for LLM tasks; avoid swapping to OpenAI without a project-wide configuration change.
- **Prometheus**: New endpoints must be registered in the metrics middleware to track latency.