import { jsonResponse, requireAuth } from '../../lib/auth.js';
import { clearInstagramCredentials } from '../../lib/storage.js';

export async function POST(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    await clearInstagramCredentials();
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('Instagram logout error:', err);
    return jsonResponse({ error: 'Abmeldung fehlgeschlagen.' }, 500);
  }
}
