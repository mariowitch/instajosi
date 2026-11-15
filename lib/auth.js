import crypto from 'node:crypto';

const COOKIE_NAME = 'heizmobil_auth';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 Tage

function getSigningSecret() {
  const base = process.env.AUTH_SECRET || process.env.APP_PASSCODE || process.env.GEMINI_API_KEY || 'dev-secret';
  return crypto.createHash('sha256').update(`heizmobil:${base}`).digest();
}

export function isAuthRequired() {
  return Boolean(process.env.APP_PASSCODE && process.env.APP_PASSCODE.trim().length > 0);
}

export function verifyPasscode(input) {
  const expected = (process.env.APP_PASSCODE || '').trim();
  if (!expected) return true;
  const a = Buffer.from(String(input || '').trim(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function signToken(exp) {
  const payload = String(exp);
  const sig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.', 2);
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expectedSig = crypto.createHmac('sha256', getSigningSecret()).update(payload).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expectedSig, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const result = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    result[key] = decodeURIComponent(val);
  }
  return result;
}

export function isAuthenticated(request) {
  if (!isAuthRequired()) return true;
  const cookies = parseCookies(request);
  return verifyToken(cookies[COOKIE_NAME]);
}

export function makeAuthCookieHeader(request) {
  const exp = Date.now() + MAX_AGE_SECONDS * 1000;
  const token = signToken(exp);
  const isHttps = (request.headers.get('x-forwarded-proto') || '').includes('https') || request.url.startsWith('https://');
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

export function makeClearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function requireAuth(request) {
  if (isAuthenticated(request)) return null;
  return jsonResponse({ error: 'Bitte zuerst anmelden.' }, 401);
}

export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
