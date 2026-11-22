import crypto from 'node:crypto';
import { httpError } from './errorHandler.js';

/**
 * Optional shared-secret check for the dev-agent routes.
 * - ADMIN_KEY unset  → open to everyone (feature is unauthenticated).
 * - ADMIN_KEY set    → caller must send it; 5 failures per IP per 15 min → 429.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
const fails = new Map(); // ip → { count, resetAt }

const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();

export const adminKeyRequired = () => Boolean(process.env.ADMIN_KEY);

function locked(ip) {
  const f = fails.get(ip);
  if (!f) return false;
  if (Date.now() > f.resetAt) {
    fails.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILS;
}

function recordFail(ip) {
  const f = fails.get(ip);
  if (!f || Date.now() > f.resetAt) fails.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else f.count += 1;
}

/** Returns true if `key` is acceptable. Records failures against `ip`. Throws 429 when locked out. */
export function checkAdminKey(key, ip = 'unknown') {
  if (!adminKeyRequired()) return true;
  if (locked(ip)) throw httpError('Too many failed attempts. Try again later.', 429);
  const ok = crypto.timingSafeEqual(digest(key ?? ''), digest(process.env.ADMIN_KEY));
  if (!ok) recordFail(ip);
  return ok;
}

export function requireAdminKey(req, _res, next) {
  try {
    const key = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!checkAdminKey(key, req.ip)) return next(httpError('Invalid admin key', 401));
    next();
  } catch (err) {
    next(err);
  }
}
