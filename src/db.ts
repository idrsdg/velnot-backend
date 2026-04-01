import Database from 'better-sqlite3';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'velnot.db');

let db: Database.Database;

export function getDb(): Database.Database {
  return db;
}

export function initDb(): void {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id   TEXT PRIMARY KEY,
      sessions_used INTEGER NOT NULL DEFAULT 0,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS licenses (
      license_key   TEXT PRIMARY KEY,
      plan          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'active',
      device_id     TEXT,
      instance_id   TEXT,
      activated_at  INTEGER NOT NULL,
      expires_at    INTEGER,
      email         TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token      TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Owner license: if OWNER_LICENSE_KEY env var is set, always upsert a lifetime license
  const ownerKey = process.env.OWNER_LICENSE_KEY;
  if (ownerKey) {
    db.prepare(`
      INSERT INTO licenses (license_key, plan, status, device_id, instance_id, activated_at, expires_at, email)
      VALUES (?, 'lifetime', 'active', NULL, NULL, ?, NULL, NULL)
      ON CONFLICT(license_key) DO UPDATE SET plan='lifetime', status='active', expires_at=NULL
    `).run(ownerKey, Date.now());
    console.log('Owner license upserted.');
  }

  console.log('DB initialized:', DB_PATH);
}

// ── Device helpers ────────────────────────────────────────────────────────────

export function getOrCreateDevice(deviceId: string): { device_id: string; sessions_used: number } {
  const now = Date.now();
  const existing = db.prepare('SELECT * FROM devices WHERE device_id = ?').get(deviceId) as
    { device_id: string; sessions_used: number; first_seen: number; last_seen: number } | undefined;

  if (existing) {
    db.prepare('UPDATE devices SET last_seen = ? WHERE device_id = ?').run(now, deviceId);
    return existing;
  }

  db.prepare('INSERT INTO devices (device_id, sessions_used, first_seen, last_seen) VALUES (?, 0, ?, ?)').run(deviceId, now, now);
  return { device_id: deviceId, sessions_used: 0 };
}

export function incrementDeviceUsage(deviceId: string): void {
  db.prepare('UPDATE devices SET sessions_used = sessions_used + 1, last_seen = ? WHERE device_id = ?').run(Date.now(), deviceId);
}

// ── License helpers ───────────────────────────────────────────────────────────

export interface LicenseRow {
  license_key: string;
  plan: string;
  status: string;
  device_id: string | null;
  instance_id: string | null;
  activated_at: number;
  expires_at: number | null;
  email: string | null;
}

export function getLicense(licenseKey: string): LicenseRow | undefined {
  return db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey) as LicenseRow | undefined;
}

export function upsertLicense(row: Omit<LicenseRow, 'activated_at' | 'email'> & { activated_at?: number; email?: string | null }): void {
  db.prepare(`
    INSERT INTO licenses (license_key, plan, status, device_id, instance_id, activated_at, expires_at, email)
    VALUES (@license_key, @plan, @status, @device_id, @instance_id, @activated_at, @expires_at, @email)
    ON CONFLICT(license_key) DO UPDATE SET
      plan        = excluded.plan,
      status      = excluded.status,
      device_id   = excluded.device_id,
      instance_id = excluded.instance_id,
      expires_at  = excluded.expires_at,
      email       = COALESCE(excluded.email, licenses.email)
  `).run({ activated_at: Date.now(), email: null, ...row });
}

export function setLicenseStatus(licenseKey: string, status: string): void {
  db.prepare('UPDATE licenses SET status = ? WHERE license_key = ?').run(status, licenseKey);
}

export function setLicenseEmail(licenseKey: string, email: string): void {
  db.prepare('UPDATE licenses SET email = ? WHERE license_key = ?').run(email, licenseKey);
}

export function getLicenseByEmail(email: string): LicenseRow | undefined {
  return db.prepare('SELECT * FROM licenses WHERE email = ? AND status = \'active\'').get(email) as LicenseRow | undefined;
}

// ── Auth token helpers ────────────────────────────────────────────────────────

export interface AuthTokenRow {
  token: string;
  email: string;
  created_at: number;
  expires_at: number;
  used: number;
}

export function insertAuthToken(token: string, email: string, expiresAt: number): void {
  const now = Date.now();
  db.prepare('INSERT INTO auth_tokens (token, email, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)').run(token, email, now, expiresAt);
}

export function getAuthToken(token: string): AuthTokenRow | undefined {
  return db.prepare('SELECT * FROM auth_tokens WHERE token = ?').get(token) as AuthTokenRow | undefined;
}

export function markAuthTokenUsed(token: string): void {
  db.prepare('UPDATE auth_tokens SET used = 1 WHERE token = ?').run(token);
}
