import crypto from 'node:crypto';
import { requireAuth } from '../../lib/auth.js';

function getOrigin(request) {
  const proto = (request.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const host = request.headers.get('host');
  return `${proto}://${host}`;
}

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const origin = getOrigin(request);
  const appId = (process.env.INSTAGRAM_APP_ID || '').trim();
  const appSecret = (process.env.INSTAGRAM_APP_SECRET || '').trim();

  if (!appId || !appSecret) {
    return Response.redirect(`${origin}/?ig_error=missing_app_config`, 302);
  }

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${origin}/api/instagram/callback`;

  const authUrl = new URL('https://www.instagram.com/oauth/authorize');
  authUrl.searchParams.set('enable_fb_login', '0');
  authUrl.searchParams.set('force_authentication', '1');
  authUrl.searchParams.set('client_id', appId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'instagram_business_basic,instagram_business_content_publish');
  authUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      'Set-Cookie': `ig_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`,
    },
  });
}
