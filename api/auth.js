import {
  isAuthRequired,
  isAuthenticated,
  jsonResponse,
  makeAuthCookieHeader,
  makeClearCookieHeader,
  verifyPasscode,
} from '../lib/auth.js';

export async function GET(request) {
  return jsonResponse({
    auth_required: isAuthRequired(),
    authenticated: isAuthenticated(request),
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!verifyPasscode(body.passcode)) {
      return jsonResponse({ error: 'Der Zugangscode stimmt leider nicht.' }, 401);
    }
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
