import { jsonResponse, requireAuth } from '../lib/auth.js';
import { getMonthlyUsage } from '../lib/storage.js';

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const usage = await getMonthlyUsage();
    return jsonResponse(usage);
  } catch (err) {
    console.error('Usage GET error:', err);
    return jsonResponse({ error: 'Zähler konnte nicht geladen werden.' }, 500);
  }
}
