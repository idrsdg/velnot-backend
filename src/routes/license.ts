import { Router, Request, Response } from 'express';
import { upsertLicense, getLicense } from '../db';

const router = Router();

// POST /api/license/activate
// Body: { license_key: string, device_id: string }
router.post('/activate', async (req: Request, res: Response) => {
  try {
    const { license_key, device_id } = req.body as { license_key?: string; device_id?: string };

    if (!license_key || !device_id) {
      res.status(400).json({ error: 'license_key ve device_id gerekli.' });
      return;
    }

    // Validate with Lemon Squeezy
    const instance_name = `velnot-${device_id.slice(0, 8)}-${Date.now()}`;
    const lsRes = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ license_key, instance_name }).toString(),
    });

    const lsData = await lsRes.json() as {
      activated?: boolean;
      error?: string;
      instance?: { id: string };
      meta?: { variant_name?: string };
      license_key?: { id: string };
    };

    if (!lsData.activated) {
      res.status(400).json({ success: false, error: lsData.error ?? 'Geçersiz lisans anahtarı.' });
      return;
    }

    // Determine plan from variant name
    const variantName = (lsData.meta?.variant_name ?? '').toLowerCase();
    let plan: 'monthly' | 'yearly' | 'lifetime' = 'lifetime';
    let expires_at: number | null = null;

    if (variantName.includes('monthly') || variantName.includes('aylık')) {
      plan = 'monthly';
      expires_at = Date.now() + 31 * 24 * 60 * 60 * 1000;
    } else if (variantName.includes('yearly') || variantName.includes('yıllık')) {
      plan = 'yearly';
      expires_at = Date.now() + 366 * 24 * 60 * 60 * 1000;
    }

    upsertLicense({
      license_key,
      plan,
      status: 'active',
      device_id,
      instance_id: lsData.instance?.id ?? null,
      expires_at,
    });

    res.json({ success: true, plan, expires_at });
  } catch (err: any) {
    console.error('License activate error:', err);
    res.status(500).json({ success: false, error: 'Bağlantı hatası: ' + (err?.message ?? '') });
  }
});

// GET /api/license/validate?license_key=...
router.get('/validate', (req: Request, res: Response) => {
  const licenseKey = req.query['license_key'] as string | undefined;
  if (!licenseKey) {
    res.status(400).json({ valid: false, error: 'license_key gerekli.' });
    return;
  }

  const lic = getLicense(licenseKey);
  if (!lic || lic.status !== 'active') {
    res.json({ valid: false });
    return;
  }

  if (lic.expires_at && Date.now() > lic.expires_at) {
    res.json({ valid: false, expired: true });
    return;
  }

  res.json({ valid: true, plan: lic.plan, expires_at: lic.expires_at });
});

export default router;
