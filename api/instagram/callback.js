import { requireAuth } from '../../lib/auth.js';
import { saveInstagramCredentials } from '../../lib/storage.js';

function getOrigin(request) {
  const proto = (request.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim();
  const host = request.headers.get('host');
  return `${proto}://${host}`;
}

function getCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  const origin = getOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const igError = url.searchParams.get('error');

  if (igError) {
    console.error('Instagram OAuth denied/error:', igError, url.searchParams.get('error_description'));
    return Response.redirect(`${origin}/?ig_error=${encodeURIComponent(igError)}`, 302);
  }

  const expectedState = getCookie(request, 'ig_oauth_state');
  if (!code || !state || !expectedState || state !== expectedState) {
    console.error('Instagram OAuth invalid state/code');
    return Response.redirect(`${origin}/?ig_error=invalid_state`, 302);
  }

  const appId = (process.env.INSTAGRAM_APP_ID || '').trim();
  const appSecret = (process.env.INSTAGRAM_APP_SECRET || '').trim();
  const redirectUri = `${origin}/api/instagram/callback`;

  try {
    // 1. Exchange code for short-lived token
    const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code,
      }),
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('Instagram token exchange failed:', tokenData);
      return Response.redirect(`${origin}/?ig_error=token_exchange_failed`, 302);
    }

    let finalToken = tokenData.access_token;
    let igUserId = String(tokenData.user_id || '');
    let expiresAt = null;

    // 2. Exchange for 60-day long-lived token
    const longUrl = new URL('https://graph.instagram.com/access_token');
    longUrl.searchParams.set('grant_type', 'ig_exchange_token');
    longUrl.searchParams.set('client_secret', appSecret);
    longUrl.searchParams.set('access_token', tokenData.access_token);
    const longRes = await fetch(longUrl);
    const longData = await longRes.json().catch(() => ({}));
    if (longRes.ok && longData.access_token) {
      finalToken = longData.access_token;
      if (longData.expires_in) {
        expiresAt = new Date(Date.now() + Number(longData.expires_in) * 1000).toISOString();
      }
    }

    // 3. Fetch profile (@username & user_id)
    let username = null;
    const meRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=user_id,username&access_token=${encodeURIComponent(finalToken)}`
    );
    const meData = await meRes.json().catch(() => ({}));
    if (meRes.ok) {
      if (meData.user_id) igUserId = String(meData.user_id);
      if (meData.username) username = meData.username;
    }

    const saved = await saveInstagramCredentials({
      access_token: finalToken,
      ig_user_id: igUserId,
      username,
      expires_at: expiresAt,
    });

    if (!saved) {
      return Response.redirect(`${origin}/?ig_error=storage_failed`, 302);
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${origin}/?ig_connected=1`,
        'Set-Cookie': 'ig_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      },
    });
  } catch (err) {
    console.error('Instagram callback error:', err);
    return Response.redirect(`${origin}/?ig_error=callback_exception`, 302);
  }
}
