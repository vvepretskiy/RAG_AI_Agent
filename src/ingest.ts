import fs from 'fs';
import { performance } from 'perf_hooks';
import { PDFParse } from 'pdf-parse';
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OllamaEmbeddings } from "@langchain/ollama";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { gunzipSync, gzipSync } from 'zlib';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const gzipToBase64 = (data: string): string => gzipSync(data, { level: 9 }).toString('base64');
const gunzipFromBase64 = (data: string): string => gunzipSync(Buffer.from(data, 'base64')).toString('utf-8');
const utf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf-8');

export type EmbeddingMode = 'plain' | 'gzip';

export interface EmbeddingRunReport {
    mode: EmbeddingMode;
    generatedAt: string;
    timingsMs: {
        total: number;
        loadPdf: number;
        split: number;
        prepareStorageDocs: number;
        prepareEmbeddingDocs: number;
        embedDocuments: number;
        indexVectors: number;
    };
    sizesBytes: {
        sourceText: number;
        storedChunkPayloadTotal: number;
        embeddingInputTotal: number;
        vectorFloat32Total: number;
    };
    counts: {
        chunks: number;
        vectors: number;
        dimensions: number;
    };
    compression: {
        ratioStoredToPlain: number;
    };
}

export interface EmbeddingBenchmarkReport {
    generatedAt: string;
    preferredMode: EmbeddingMode;
    selectedMode: EmbeddingMode;
    plain: EmbeddingRunReport;
    gzip: EmbeddingRunReport;
}

export const loadPdf = async (path: string): Promise<string> => {
    let stat: fs.Stats;
    try {
        stat = await fs.promises.stat(path);
    } catch (err) {
        throw new Error(`File not found: ${path}`);
    }

    if (!stat.isFile()) {
        throw new Error(`Not a file: ${path}`);
    }

    if (stat.size > MAX_BYTES) {
        throw new Error(`File too large: ${stat.size} bytes (max ${MAX_BYTES} bytes)`);
    }

    const dataBuffer = await fs.promises.readFile(path);
    const parser = new PDFParse({ data: dataBuffer });
    const result = await parser.getText();
    return result.text;
};

const createStorageDocs = async (
    chunks: string[],
    mode: EmbeddingMode,
): Promise<Array<{ pageContent: string; metadata: Record<string, unknown> }>> => {
    const storageSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: Number.MAX_SAFE_INTEGER,
        chunkOverlap: 0,
    });

    if (mode === 'plain') {
        const plainDocs = await storageSplitter.createDocuments(chunks);
        return plainDocs.map((doc) => ({
            pageContent: doc.pageContent,
            metadata: {
                ...doc.metadata,
                storageFormat: 'plain',
            },
        }));
    }

    const gzChunks = chunks.map((chunk) => `gz:${gzipToBase64(chunk)}`);
    const gzipDocs = await storageSplitter.createDocuments(gzChunks);
    return gzipDocs.map((doc) => ({
        pageContent: doc.pageContent,
        metadata: {
            ...doc.metadata,
            storageFormat: 'gzip-base64',
        },
    }));
};

export const runEmbeddingPipeline = async (mode: EmbeddingMode): Promise<{
    vectorStore: MemoryVectorStore;
    report: EmbeddingRunReport;
}> => {
    const chunkSize = parseInt(process.env.CHUNK_SIZE ?? '1000');
    const chunkOverlap = parseInt(process.env.CHUNK_OVERLAP ?? '200');
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });

    const startedAt = performance.now();

    const loadStart = performance.now();
    const text = await loadPdf(process.env.FILE_PATH!);
    const loadPdfMs = performance.now() - loadStart;

    const splitStart = performance.now();
    const plainChunks = await splitter.splitText(text);
    const splitMs = performance.now() - splitStart;

    const storageStart = performance.now();
    const storageDocs = await createStorageDocs(plainChunks, mode);
    const prepareStorageDocsMs = performance.now() - storageStart;

    const embeddingDocsStart = performance.now();
    const embeddingDocs = storageDocs.map((doc) => {
        if (mode === 'gzip') {
            const payload = doc.pageContent.startsWith('gz:') ? doc.pageContent.slice(3) : doc.pageContent;
            return {
                pageContent: gunzipFromBase64(payload),
                metadata: {
                    ...doc.metadata,
                    compressed: doc.pageContent,
                },
            };
        }

        return {
            pageContent: doc.pageContent,
            metadata: doc.metadata,
        };
    });
    const prepareEmbeddingDocsMs = performance.now() - embeddingDocsStart;

    const embeddings = new OllamaEmbeddings({
        model: process.env.EMBEDDING_MODEL,
        baseUrl: process.env.OLLAMA_BASE_URL,
    });

    const embedStart = performance.now();
    const vectors = await embeddings.embedDocuments(embeddingDocs.map((doc) => doc.pageContent));
    const embedDocumentsMs = performance.now() - embedStart;

    const vectorStore = new MemoryVectorStore(embeddings);
    const indexStart = performance.now();
    await vectorStore.addVectors(vectors, embeddingDocs as any);
    const indexVectorsMs = performance.now() - indexStart;

    const dimensions = vectors[0]?.length ?? 0;
    const plainStoredBytes = plainChunks.reduce((total, chunk) => total + utf8Bytes(chunk), 0);
    const storedChunkPayloadTotal = storageDocs.reduce((total, doc) => total + utf8Bytes(doc.pageContent), 0);
    const embeddingInputTotal = embeddingDocs.reduce((total, doc) => total + utf8Bytes(doc.pageContent), 0);

    const report: EmbeddingRunReport = {
        mode,
        generatedAt: new Date().toISOString(),
        timingsMs: {
            total: performance.now() - startedAt,
            loadPdf: loadPdfMs,
            split: splitMs,
            prepareStorageDocs: prepareStorageDocsMs,
            prepareEmbeddingDocs: prepareEmbeddingDocsMs,
            embedDocuments: embedDocumentsMs,
            indexVectors: indexVectorsMs,
        },
        sizesBytes: {
            sourceText: utf8Bytes(text),
            storedChunkPayloadTotal,
            embeddingInputTotal,
            vectorFloat32Total: vectors.length * dimensions * 4,
        },
        counts: {
            chunks: plainChunks.length,
            vectors: vectors.length,
            dimensions,
        },
        compression: {
            ratioStoredToPlain: plainStoredBytes === 0 ? 1 : Number((storedChunkPayloadTotal / plainStoredBytes).toFixed(4)),
        },
    };

    return { vectorStore, report };
};

export const benchmarkEmbeddingPipelines = async (preferredMode: EmbeddingMode = 'gzip'): Promise<{
    vectorStore: MemoryVectorStore;
    report: EmbeddingBenchmarkReport;
}> => {
    const plainResult = await runEmbeddingPipeline('plain');
    const gzipResult = await runEmbeddingPipeline('gzip');

    const selectedMode: EmbeddingMode = preferredMode === 'plain' ? 'plain' : 'gzip';
    const vectorStore = selectedMode === 'plain' ? plainResult.vectorStore : gzipResult.vectorStore;

    return {
        vectorStore,
        report: {
            generatedAt: new Date().toISOString(),
            preferredMode,
            selectedMode,
            plain: plainResult.report,
            gzip: gzipResult.report,
        },
    };
};

export const embedPdf = async () => {
    const mode: EmbeddingMode = process.env.EMBEDDING_STORAGE_MODE === 'plain' ? 'plain' : 'gzip';
    const result = await runEmbeddingPipeline(mode);

    return result.vectorStore;
}