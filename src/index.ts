import express from 'express';
import { initAgent, askAgent } from './agent';
import dotenv from "dotenv";
import logger from './logger';

dotenv.config();
logger.init();

const app = express();
app.use(express.json());

app.post('/ask', async (req, res) => {
    try {
        const { question } = req.body;

        console.log('Received question:', question);

        if (!question) {
            return res.status(400).json({ error: "Question is required" });
        }

        const answer = await askAgent(question);

        console.log('Answer:', answer);

        res.json({ answer });
    } catch (error: {message?: string} | unknown) {
        const message = (typeof error === 'object' && error !== null && "message" in error) ? error.message : String(error) ?? 'Unknown error';
         // inside catch
        res.status(500).json({ error: message });
    }
});

app.get('/health', (_, res) => {
    res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;

console.log(`Starting server on port ${PORT}...`);

const server = app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    try {
        await initAgent();
        console.log('Agent initialized');
    } catch (err) {
        console.error('initAgent failed:', err);
        process.exit(1);
    }
});