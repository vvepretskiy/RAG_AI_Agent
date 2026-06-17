import { Router } from 'express';
import { askAgent } from '../agent';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || question.trim() === '') {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.info({ question }, 'Received question');

    const answer = await askAgent(question);

    console.info({ answer }, 'Answer generated');

    res.json({ answer });
  } catch (err) {
    next(err);
  }
});

export default router;
