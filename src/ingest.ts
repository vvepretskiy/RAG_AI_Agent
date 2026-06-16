import fs from 'fs';
import { PDFParse } from 'pdf-parse';
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OllamaEmbeddings } from "@langchain/ollama";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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

export const embedPdf = async () => {
    const chunkSize = parseInt(process.env.CHUNK_SIZE ?? '1000');
    const chunkOverlap = parseInt(process.env.CHUNK_OVERLAP ?? '200');

    const splitter = new RecursiveCharacterTextSplitter({ chunkSize, chunkOverlap });

    const text = await loadPdf(process.env.FILE_PATH!);
    const chunks = await splitter.createDocuments([text]);

    // generate embeddings for each chunk using local Ollama model
    const embeddings = new OllamaEmbeddings({
        model: process.env.EMBEDDING_MODEL,
        baseUrl: process.env.OLLAMA_BASE_URL,
    });
    const vectorStore = await MemoryVectorStore.fromDocuments(chunks, embeddings);

    return vectorStore;
}