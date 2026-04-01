import { Request, Response, NextFunction } from 'express';
import { getOrCreateDevice, getLicense } from '../db';

const FREE_LIMIT = parseInt(process.env.FREE_SESSION_LIMIT ?? '3');

export interface AuthInfo {
  deviceId: string;
  licenseKey: string | null;
  plan: 'free' | 'monthly' | 'yearly' | 'lifetime';
  sessionsUsed: number;
  limit: number; // -1 = unlimited
}

declare global {
  namespace Express {
    interface Request {
      auth: AuthInfo;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const deviceId = req.headers['x-device-id'] as string | undefined;
  if (!deviceId || deviceId.trim() === '') {
    res.status(400).json({ error: 'x-device-id header gerekli.' });
    return;
  }

  const licenseKey = (req.headers['x-license-key'] as string | undefined) ?? null;

  // Admin bypass: if license key matches ADMIN_KEY env var, grant unlimited access
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && licenseKey === adminKey) {
    req.auth = {
      deviceId,
      licenseKey,
      plan: 'lifetime',
      sessionsUsed: 0,
      limit: -1,
    };
    next();
    return;
  }

  const device = getOrCreateDevice(deviceId);

  // Paid license check
  if (licenseKey) {
    const lic = getLicense(licenseKey);
    if (lic && lic.status === 'active') {
      // Check expiry for monthly/yearly
      if (lic.expires_at && Date.now() > lic.expires_at) {
        res.status(402).json({ error: 'LICENSE_EXPIRED', message: 'Lisansın süresi doldu.' });
        return;
      }
      req.auth = {
        deviceId,
        licenseKey,
        plan: lic.plan as AuthInfo['plan'],
        sessionsUsed: device.sessions_used,
        limit: -1,
      };
      next();
      return;
    }
    // Invalid / inactive license — fall through to free tier check
  }

  // Free tier
  if (device.sessions_used >= FREE_LIMIT) {
    res.status(402).json({
      error: 'QUOTA_EXCEEDED',
      message: `Ücretsiz ${FREE_LIMIT} kayıt limitine ulaştın. Devam etmek için plan satın al.`,
      used: device.sessions_used,
      limit: FREE_LIMIT,
    });
    return;
  }

  req.auth = {
    deviceId,
    licenseKey: null,
    plan: 'free',
    sessionsUsed: device.sessions_used,
    limit: FREE_LIMIT,
  };
  next();
}
