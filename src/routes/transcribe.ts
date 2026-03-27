import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { incrementDeviceUsage } from '../db';

const router = Router();

const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY ?? '';

interface AssemblyPollResult {
  status: string;
  utterances?: { speaker: string; text: string; start: number; end: number }[];
  text?: string;
  error?: string;
}

async function transcribeAudio(
  audioBuffer: Buffer,
  language: string,
): Promise<{ transcript: string; utterances: { speaker: string; text: string; start: number; end: number }[] }> {
  // 1. Upload audio
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      authorization: ASSEMBLYAI_KEY,
      'content-type': 'application/octet-stream',
    },
    body: audioBuffer as unknown as BodyInit,
  });

  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '');
    throw new Error(`AssemblyAI upload hatası: ${uploadRes.status} — ${body}`);
  }

  const { upload_url } = await uploadRes.json() as { upload_url: string };

  // 2. Start transcription
  const lang = language !== 'auto' ? language : undefined;
  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { authorization: ASSEMBLYAI_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      speaker_labels: true,
      speech_models: 'best',
      speakers_expected: 2,
      ...(lang ? { language_code: lang } : {}),
    }),
  });

  if (!transcriptRes.ok) {
    const body = await transcriptRes.text().catch(() => '');
    throw new Error(`AssemblyAI transcript isteği hatası: ${transcriptRes.status} — ${body}`);
  }

  const { id } = await transcriptRes.json() as { id: string };

  // 3. Poll
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { authorization: ASSEMBLYAI_KEY },
    });
    const data = await poll.json() as AssemblyPollResult;

    if (data.status === 'completed') {
      if (data.utterances?.length) {
        const utterances = data.utterances.map(u => ({
          speaker: u.speaker, text: u.text, start: u.start, end: u.end,
        }));
        const transcript = utterances.map(u => `Konuşmacı ${u.speaker}: ${u.text}`).join('\n');
        return { transcript, utterances };
      }
      return { transcript: data.text ?? '', utterances: [] };
    }

    if (data.status === 'error') throw new Error(`AssemblyAI hatası: ${data.error}`);
  }

  throw new Error('AssemblyAI zaman aşımı.');
}

// POST /api/transcribe  — full diarization (body: raw audio buffer)
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Ses verisi bulunamadı.' });
      return;
    }

    const language = (req.headers['x-language'] as string) || 'tr';
    const result = await transcribeAudio(req.body, language);

    incrementDeviceUsage(req.auth.deviceId);

    res.json(result);
  } catch (err: any) {
    console.error('Transcribe error:', err);
    res.status(500).json({ error: err.message ?? 'Transkripsiyon başarısız.' });
  }
});

// POST /api/transcribe/chunk  — Whisper chunk (real-time, no diarization)
router.post('/chunk', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: 'Ses verisi bulunamadı.' });
      return;
    }

    const language = (req.headers['x-language'] as string) || 'tr';
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { Readable } = await import('node:stream');
    const audioStream = Readable.from(req.body);
    (audioStream as any).name = 'audio.webm';

    const response = await client.audio.transcriptions.create({
      file: audioStream as any,
      model: 'whisper-1',
      ...(language !== 'auto' ? { language } : {}),
    });

    res.json({ transcript: response.text });
  } catch (err: any) {
    console.error('Chunk transcribe error:', err);
    res.status(500).json({ error: err.message ?? 'Chunk transkripsiyon başarısız.' });
  }
});

export default router;
