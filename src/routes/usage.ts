import { Router, Request, Response } from 'express';
import { getOrCreateDevice, getLicense } from '../db';

const router = Router();

const FREE_LIMIT = parseInt(process.env.FREE_SESSION_LIMIT ?? '3');

// GET /api/usage?device_id=...&license_key=...
router.get('/', (req: Request, res: Response) => {
  const deviceId = req.query['device_id'] as string | undefined;
  const licenseKey = req.query['license_key'] as string | undefined;

  if (!deviceId) {
    res.status(400).json({ error: 'device_id gerekli.' });
    return;
  }

  const device = getOrCreateDevice(deviceId);

  if (licenseKey) {
    const lic = getLicense(licenseKey);
    if (lic && lic.status === 'active') {
      const expired = lic.expires_at ? Date.now() > lic.expires_at : false;
      res.json({
        plan: lic.plan,
        used: device.sessions_used,
        limit: -1,
        remaining: -1,
        valid: !expired,
        expires_at: lic.expires_at,
      });
      return;
    }
  }

  res.json({
    plan: 'free',
    used: device.sessions_used,
    limit: FREE_LIMIT,
    remaining: Math.max(0, FREE_LIMIT - device.sessions_used),
    valid: device.sessions_used < FREE_LIMIT,
  });
});

export default router;
