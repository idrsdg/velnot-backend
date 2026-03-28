import { Router, Request, Response } from 'express';
import { upsertLicense } from '../db';
import crypto from 'node:crypto';

const router = Router();

// POST /api/admin/insert-license
// Header: x-admin-secret: <ADMIN_SECRET>
// Body: { email, plan, licenseKey?, expiresAt? }
router.post('/insert-license', (req: Request, res: Response) => {
  const secret = req.headers['x-admin-secret'];
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || secret !== adminSecret) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const { email, plan, licenseKey, expiresAt } = req.body as {
    email?: string;
    plan?: string;
    licenseKey?: string;
    expiresAt?: number;
  };

  if (!email || !plan) {
    res.status(400).json({ error: 'email and plan required' });
    return;
  }

  const key = licenseKey ?? `MANUAL-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;

  upsertLicense({
    license_key: key,
    plan,
    status: 'active',
    device_id: null,
    instance_id: null,
    expires_at: expiresAt ?? null,
    email,
  });

  res.json({ ok: true, license_key: key, email, plan });
});

export default router;
