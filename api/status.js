import { isAuthRequired, isAuthenticated, jsonResponse } from '../lib/auth.js';
import { getMonthlyUsage, isBlobConfigured, isRedisConfigured } from '../lib/storage.js';

export async function GET(request) {
  try {
    const authenticated = isAuthenticated(request);
    const usage = authenticated ? await getMonthlyUsage() : null;

    return jsonResponse({
      server: 'ok',
      auth_required: isAuthRequired(),
      authenticated,
      gemini_api_key: process.env.GEMINI_API_KEY ? 'configured' : 'missing',
      instagram_configured: Boolean(
        process.env.INSTAGRAM_ACCOUNT_ID && process.env.INSTAGRAM_ACCESS_TOKEN
      ),
      public_base_url_configured: true,
      blob_configured: isBlobConfigured(),
      redis_configured: isRedisConfigured(),
      usage,
    });
  } catch (err) {
    console.error('Status GET error:', err);
    return jsonResponse({ error: 'Status konnte nicht geladen werden.' }, 500);
  }
}
