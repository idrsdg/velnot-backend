import { Router, Request, Response } from 'express';

const router = Router();

const DL_URL = 'https://github.com/idrsdg/velnot/releases/latest/download/Velnot-Setup.exe';

// POST /api/download-request
// Body: { email: string }
router.post('/', async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'valid email required' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();

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
          from: 'Velnot <noreply@velnot.com>',
          to: [normalizedEmail],
          subject: 'Velnot İndirme Linkin',
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f0f0f;color:#e5e5e5;border-radius:12px">
              <h2 style="color:#f97316;margin-bottom:8px">Velnot</h2>
              <p style="margin-bottom:20px">Velnot'u indirmek için aşağıdaki butona tıkla:</p>
              <a href="${DL_URL}" style="display:inline-block;padding:12px 28px;background:#f97316;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:24px">
                ⬇ Velnot'u İndir (Windows)
              </a>
              <p style="color:#999;font-size:13px;margin-bottom:8px">İlk 3 kaydın ücretsiz — kayıt veya kart gerekmez.</p>
              <p style="color:#666;font-size:12px">Bu emaili siz istediniz. İstemiyorsanız görmezden gelebilirsiniz.</p>
            </div>
          `,
        }),
      });
    } catch (err) {
      console.error('Resend download email error:', err);
    }
  } else {
    console.log(`[DEV] Download link for ${normalizedEmail}: ${DL_URL}`);
  }

  res.json({ sent: true });
});

export default router;
