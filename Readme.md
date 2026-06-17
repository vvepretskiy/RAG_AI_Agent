# RAG Agent

A simple Retrieval-Augmented Generation (RAG) agent that reads files, creates embedded vectors, and answers questions by retrieving similar document chunks. Exposes a POST API endpoint /ask that accepts { "question": "..." } and returns the best-matching document response.

## Features
- Load documents (PDF / text) from disk
- Chunking with configurable size and overlap
- Create embeddings and store vectors for similarity search
- POST /ask API to query the agent
- Optional invoke timeout handling
- Environment-configurable (via .env)

## System Architecture
The project follows a Retrieval-Augmented Generation (RAG) pattern:
1. **Ingestion**: `ingest.ts` reads PDF files from `FILE_PATH`, chunks them using `RecursiveCharacterTextSplitter`, and generates embeddings via `OllamaEmbeddings`.
2. **Storage**: Vectors are stored in an in-memory `MemoryVectorStore`.
3. **Retrieval**: When a question is asked, the `MemoryVectorStore` retrieves the most relevant chunks.
4. **Generation**: `agent.ts` uses `ChatOllama` to generate a response based on the retrieved context.

## Technical Stack
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **AI Orchestration**: LangChain
- **Embeddings/LLM**: Ollama (local)
- **Observability**: Prometheus (`prom-client`)
- **Configuration**: Dotenv

## Requirements
- Node.js 18+ (or compatible)
- npm or yarn

## Installation
1. Clone the repo
2. Install dependencies
```bash
npm install
# or
yarn
```

## Environment (.env)
Create a `.env` file in the project root and set the following variables:

```
PORT=5010
NODE_ENV=development
OLLAMA_BASE_URL=
AGENT_MODEL=
EMBEDDING_MODEL=

TIMEOUT_RESPONSE=20000
CHUNK_SIZE=1000
CHUNK_OVERLAP=200

FILE_PATH=data/your-file.pdf
```

- PORT: HTTP server port (default example 5010).
- NODE_ENV: e.g., `development` or `production`.
- OLLAMA_BASE_URL / AGENT_MODEL / EMBEDDING_MODEL: model/service configuration for embeddings and agent.
- TIMEOUT_RESPONSE: optional agent invoke timeout in milliseconds (e.g., 20000). If set, a timed-out invoke returns HTTP 504 with message "invoke timeout".
- CHUNK_SIZE / CHUNK_OVERLAP: chunking parameters for document splitting.
- FILE_PATH: path to input files (single file or directory depending on implementation).

Do not commit your .env or secrets.

## Usage
Start the application:

```bash
# development
npm start

# or run compiled output
node ./dist/index.js
```

Ensure you import and initialize the logger early if using the provided logger module:

```ts
import logger from "./src/logger";
logger.init();
```

## API

POST /ask
- Request
  - Content-Type: application/json
  - Body:
  ```json
  {
    "question": "What is the capital of France?"
  }
  ```
- Success response (200):
  ```json
  {
    "answer": "Paris is the capital of France..."
  }
  ```
- Errors
  - 400: missing question
  - 504: invoke timeout (body contains "invoke timeout")
  - 500: other server errors (body contains error message)

## Implementation Notes
- The server reads files from FILE_PATH, splits text into chunks using CHUNK_SIZE and CHUNK_OVERLAP, creates embeddings using EMBEDDING_MODEL, and stores vectors for similarity search.
- The /ask handler:
  - Validates the question
  - Calls the agent (qaChain.invoke) to get an answer
  - If TIMEOUT_RESPONSE is set, races the invoke against a timeout and returns 504 with message "invoke timeout" on timeout
  - Normalizes errors using a safe extractor to include the error message in the JSON response
- File size limits: the project includes checks (e.g., 5 MB default) to avoid processing overly large files; adjust as needed.

## Error Handling
- Use a helper to safely extract error messages from unknown values:
```ts
function isErrorWithMessage(err: unknown): err is { message: string } {
  return typeof err === 'object' && err !== null && 'message' in err && typeof (err as any).message === 'string';
}
function getErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (isErrorWithMessage(err)) return err.message;
  return String(err ?? 'Unknown error');
}
```
- In routes, map timeout message to 504:
```ts
const message = getErrorMessage(err);
const status = message === 'invoke timeout' ? 504 : 500;
res.status(status).json({ error: message });
```

## Tips & Extensibility
- Call logger.init() before other imports to control console logging in non-dev environments.
- Override or extend chunking, embedding model, or vector store implementations for scale.
- To cancel underlying requests on timeout, integrate AbortController or model/client-specific cancellation.
- Add support for more file formats and larger file handling by adjusting chunking and file-size checks.

## Troubleshooting
- If you receive empty error objects in responses, ensure your route extracts and returns the error message (see Error Handling).
- Verify FILE_PATH exists and files are readable.
- Confirm embedding and agent model environment variables are set and reachable.

## License
Add your project license information here.