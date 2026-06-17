import { embedPdf } from "./ingest";
import { ChatOllama } from "@langchain/ollama";
import { RetrievalQAChain } from "@langchain/classic/chains";

let qaChain: RetrievalQAChain | null = null;

export const initAgent = async () => {
    console.log("Initializing agent...");

    const vectorStore = await embedPdf();

    // RAG
    const retriever = vectorStore.asRetriever();

    const model = new ChatOllama({
        model: process.env.AGENT_MODEL,
        temperature: 0,
        baseUrl: process.env.OLLAMA_BASE_URL,
    });

    const chain = RetrievalQAChain.fromLLM(model, retriever);
    qaChain = chain;
}

export const askAgent = async (question: string) => {
    if (!qaChain) {
        throw new Error("Agent not initialized. Please call initAgent() first.");
    }

    console.log("Asking agent:", question);

    try {

        let answer;

        if (!process.env.TIMEOUT_RESPONSE) {
            answer = await qaChain.invoke({ query: question });
        } else {
            const timeoutMs = parseInt(process.env.TIMEOUT_RESPONSE, 10);
            const controller = new AbortController();

            const answerPromise = qaChain.invoke(
                { query: question },
                { callbacks: [], signal: controller.signal }
            );

            const timeout = (ms: number) =>
                new Promise<never>((_, rej) => setTimeout(() => {
                    controller.abort();
                    rej(new Error("invoke timeout"));
                }, ms));

            // race the invoke promise against timeout
            answer = (await Promise.race([answerPromise, timeout(timeoutMs)])) as { text?: string };
        }

        const text = answer?.text ?? String(answer);
        console.log("Answer:", text);

        return text;
    } catch (err) {
        console.error("askAgent error:", err);
        throw err;
    }
}