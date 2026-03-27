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
      expires_at    INTEGER
    );
  `);

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
}

export function getLicense(licenseKey: string): LicenseRow | undefined {
  return db.prepare('SELECT * FROM licenses WHERE license_key = ?').get(licenseKey) as LicenseRow | undefined;
}

export function upsertLicense(row: Omit<LicenseRow, 'activated_at'> & { activated_at?: number }): void {
  db.prepare(`
    INSERT INTO licenses (license_key, plan, status, device_id, instance_id, activated_at, expires_at)
    VALUES (@license_key, @plan, @status, @device_id, @instance_id, @activated_at, @expires_at)
    ON CONFLICT(license_key) DO UPDATE SET
      plan        = excluded.plan,
      status      = excluded.status,
      device_id   = excluded.device_id,
      instance_id = excluded.instance_id,
      expires_at  = excluded.expires_at
  `).run({ activated_at: Date.now(), ...row });
}

export function setLicenseStatus(licenseKey: string, status: string): void {
  db.prepare('UPDATE licenses SET status = ? WHERE license_key = ?').run(status, licenseKey);
}
