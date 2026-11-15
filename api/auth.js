import {
  isAuthRequired,
  isAuthenticated,
  jsonResponse,
  makeAuthCookieHeader,
  makeClearCookieHeader,
  verifyPasscode,
} from '../lib/auth.js';
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordFailedLogin,
} from '../lib/storage.js';

function getClientIp(request) {
  const xff = request.headers.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
}

export async function GET(request) {
  return jsonResponse({
    auth_required: isAuthRequired(),
    authenticated: isAuthenticated(request),
  });
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const limitState = await checkLoginRateLimit(ip);
    if (limitState.blocked) {
      return jsonResponse(
        { error: 'Zu viele falsche Versuche. Bitte 15 Minuten warten.' },
        429
      );
    }

    const body = await request.json().catch(() => ({}));
    if (!verifyPasscode(body.passcode)) {
      await recordFailedLogin(ip);
      return jsonResponse({ error: 'Der Zugangscode stimmt leider nicht.' }, 401);
    }

    await clearLoginFailures(ip);
    return jsonResponse(
      { ok: true, authenticated: true },
      200,
      { 'Set-Cookie': makeAuthCookieHeader(request) }
    );
  } catch (err) {
    console.error('Auth POST error:', err);
    return jsonResponse({ error: 'Anmeldung fehlgeschlagen.' }, 500);
  }
}

export async function DELETE() {
  return jsonResponse(
    { ok: true, authenticated: false },
    200,
    { 'Set-Cookie': makeClearCookieHeader() }
  );
}
