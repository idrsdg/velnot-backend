import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { getLicenseByEmail, insertAuthToken, getAuthToken, markAuthTokenUsed } from '../db';

const router = Router();

const BACKEND_URL = process.env.BACKEND_URL ?? 'https://velnot-backend.onrender.com';
const TTL_MS = 15 * 60 * 1000; // 15 minutes

// POST /api/auth/request-magic-link
// Body: { email: string }
router.post('/request-magic-link', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email || typeof email !== 'string') {
    res.status(400).json({ error: 'email required' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Always respond with sent: true for security (don't leak whether email exists)
  const license = getLicenseByEmail(normalizedEmail);

  if (license) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + TTL_MS;
    insertAuthToken(token, normalizedEmail, expiresAt);

    const verifyUrl = `${BACKEND_URL}/api/auth/verify?token=${token}`;

    // Send email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Velnot <onboarding@resend.dev>',
            to: [normalizedEmail],
            subject: "Velnot'a giriş linkin",
            html: `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
                <h2 style="color:#f97316">Velnot</h2>
                <p>Uygulamaya giriş yapmak için aşağıdaki butona tıkla:</p>
                <a href="${verifyUrl}" style="display:inline-block;padding:12px 24px;background:#f97316;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0">
                  Uygulamaya Giriş Yap →
                </a>
                <p style="color:#888;font-size:13px">Bu link 15 dakika geçerlidir. Eğer bu isteği sen yapmadıysan bu emaili görmezden gelebilirsin.</p>
              </div>
            `,
          }),
        });
      } catch (err) {
        console.error('Resend email error:', err);
      }
    } else {
      // Dev mode: log the link
      console.log(`[DEV] Magic link for ${normalizedEmail}: ${verifyUrl}`);
    }
  }

  res.json({ sent: true });
});

// GET /api/auth/verify?token=xxx
router.get('/verify', (req: Request, res: Response) => {
  const token = req.query['token'] as string | undefined;

  if (!token) {
    res.status(400).send('<h2>Geçersiz link.</h2>');
    return;
  }

  const row = getAuthToken(token);

  if (!row || row.used || Date.now() > row.expires_at) {
    res.status(400).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px">
        <h2 style="color:#f87171">Link geçersiz veya süresi dolmuş.</h2>
        <p>Uygulamadan yeni bir link talep edebilirsin.</p>
      </body></html>
    `);
    return;
  }

  markAuthTokenUsed(token);

  const license = getLicenseByEmail(row.email);
  const plan = license?.plan ?? 'unknown';
  const expires = license?.expires_at ?? '';

  // Redirect to app via deep link
  const deepLink = `velnotauth://login?email=${encodeURIComponent(row.email)}&plan=${encodeURIComponent(plan)}&expires=${encodeURIComponent(String(expires))}`;

  res.send(`
    <html>
      <head>
        <meta http-equiv="refresh" content="2;url=${deepLink}">
        <style>body{font-family:sans-serif;text-align:center;padding:60px;background:#0f0f0f;color:#e5e5e5}</style>
      </head>
      <body>
        <h2 style="color:#f97316">Yönlendiriliyor...</h2>
        <p>Velnot açılıyor. Uygulama otomatik açılmazsa <a href="${deepLink}" style="color:#f97316">buraya tıkla</a>.</p>
        <script>window.location.href = ${JSON.stringify(deepLink)};</script>
      </body>
    </html>
  `);
});

export default router;
