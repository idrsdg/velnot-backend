import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { upsertLicense, setLicenseStatus } from '../db';

const router = Router();

function verifySignature(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) return true; // Skip in dev if not set

  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(signature, 'hex'));
}

// POST /api/webhook/lemonsqueezy
router.post('/lemonsqueezy', (req: Request, res: Response) => {
  const signature = req.headers['x-signature'] as string | undefined;
  if (!signature || !verifySignature(req.body as Buffer, signature)) {
    res.status(401).json({ error: 'Invalid signature.' });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse((req.body as Buffer).toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON.' });
    return;
  }

  const event = req.headers['x-event-name'] as string;
  const attrs = payload?.data?.attributes ?? {};
  const licenseKey: string = attrs.license_key ?? attrs.key ?? '';
  const variantName: string = (attrs.variant_name ?? attrs.first_order_item?.variant_name ?? '').toLowerCase();
  const status: string = attrs.status ?? 'active';

  if (!licenseKey) {
    res.status(200).json({ ok: true }); // Nothing to update
    return;
  }

  const plan = variantName.includes('monthly') || variantName.includes('aylık')
    ? 'monthly'
    : variantName.includes('yearly') || variantName.includes('yıllık')
      ? 'yearly'
      : 'lifetime';

  const expires_at =
    plan === 'monthly' ? Date.now() + 31 * 24 * 60 * 60 * 1000 :
    plan === 'yearly'  ? Date.now() + 366 * 24 * 60 * 60 * 1000 :
    null;

  switch (event) {
    case 'order_created':
    case 'subscription_created':
      upsertLicense({
        license_key: licenseKey,
        plan,
        status: 'active',
        device_id: null,
        instance_id: null,
        expires_at,
      });
      break;

    case 'subscription_updated':
      if (status === 'active' || status === 'on_trial') {
        upsertLicense({ license_key: licenseKey, plan, status: 'active', device_id: null, instance_id: null, expires_at });
      } else {
        setLicenseStatus(licenseKey, 'cancelled');
      }
      break;

    case 'subscription_cancelled':
    case 'subscription_expired':
      setLicenseStatus(licenseKey, 'cancelled');
      break;

    case 'license_key_updated':
      if (status === 'inactive' || status === 'disabled') {
        setLicenseStatus(licenseKey, 'cancelled');
      }
      break;
  }

  console.log(`Webhook [${event}] — license: ${licenseKey} plan: ${plan}`);
  res.status(200).json({ ok: true });
});

export default router;
