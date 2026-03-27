import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { requireAuth } from '../middleware/auth';

const router = Router();
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type ProcessMode = 'summary' | 'action_plan' | 'meeting_notes';

const PROMPTS: Record<ProcessMode, string> = {
  summary: `You are a meeting assistant. From the given transcript, produce:
1. A short appropriate title for the meeting
2. A 3-5 bullet point summary
3. An empty action_items list

Respond in the SAME LANGUAGE as the transcript. Reply in JSON:
{
  "title": "...",
  "summary": ["point1", "point2", ...],
  "action_items": []
}`,

  action_plan: `You are a meeting assistant. From the given transcript, produce:
1. A short appropriate title for the meeting
2. An empty summary list
3. All action items (who does what, by when)

Respond in the SAME LANGUAGE as the transcript. Reply in JSON:
{
  "title": "...",
  "summary": [],
  "action_items": [
    { "task": "...", "owner": "...", "deadline": "..." }
  ]
}`,

  meeting_notes: `You are a meeting assistant. Produce professional meeting notes from the transcript.
Include: participants (if mentioned), main agenda items, decisions, next steps.

Respond in the SAME LANGUAGE as the transcript. Reply in JSON:
{
  "title": "...",
  "summary": ["## Agenda\\n item...", "## Decisions\\n item...", "## Next Steps\\n item..."],
  "action_items": []
}`,
};

// POST /api/summarize  — body: { transcript: string, mode?: ProcessMode }
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { transcript, mode = 'summary' } = req.body as { transcript?: string; mode?: ProcessMode };

    if (!transcript || transcript.trim() === '') {
      res.status(400).json({ error: 'transcript alanı gerekli.' });
      return;
    }

    if (!PROMPTS[mode]) {
      res.status(400).json({ error: 'Geçersiz mode. summary | action_plan | meeting_notes olmalı.' });
      return;
    }

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: PROMPTS[mode] },
        { role: 'user', content: transcript },
      ],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    if (!content) throw new Error('GPT boş yanıt döndürdü.');

    res.json(JSON.parse(content));
  } catch (err: any) {
    console.error('Summarize error:', err);
    res.status(500).json({ error: err.message ?? 'Özet oluşturulamadı.' });
  }
});

export default router;
