import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initDb } from './db';
import transcribeRouter from './routes/transcribe';
import summarizeRouter from './routes/summarize';
import licenseRouter from './routes/license';
import usageRouter from './routes/usage';
import webhookRouter from './routes/webhook';
import authRouter from './routes/auth';
import downloadRouter from './routes/download';
import adminRouter from './routes/admin';

const app = express();

app.use(cors());

// Webhook must receive raw body for signature verification
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRouter);

// Binary audio uploads (max 500MB)
app.use('/api/transcribe', express.raw({ type: 'application/octet-stream', limit: '500mb' }), transcribeRouter);

app.use(express.json());
app.use('/api/summarize', summarizeRouter);
app.use('/api/license', licenseRouter);
app.use('/api/usage', usageRouter);
app.use('/api/auth', authRouter);
app.use('/api/download-request', downloadRouter);

app.use('/api/admin', adminRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));

initDb();

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`Velnot API running on port ${PORT}`));
