import { jsonResponse, requireAuth } from '../lib/auth.js';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

function resolvePublicImageUrl(imageUrl, request) {
  if (imageUrl.startsWith('https://')) {
    return imageUrl;
  }
  const cleanRel = imageUrl.replace(/^\/+/, '');
  const base = (
    process.env.PUBLIC_BASE_URL ||
    (request.headers.get('host') ? `https://${request.headers.get('host')}` : '')
  ).replace(/\/+$/, '');

  if (!base.startsWith('https://')) {
    throw new Error('Für Instagram wird eine öffentliche https://-Adresse benötigt.');
  }
  return `${base}/${cleanRel}`;
}

export async function POST(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const igUserId = (process.env.INSTAGRAM_ACCOUNT_ID || '').trim();
    const accessToken = (process.env.INSTAGRAM_ACCESS_TOKEN || '').trim();

    if (!igUserId || !accessToken) {
      return jsonResponse(
        { error: 'Instagram-Zugangsdaten fehlen in den Vercel Environment Variables.' },
        400
      );
    }

    const body = await request.json();
    const rawImageUrl = (body.image_url || '').trim();
    const caption = body.caption || '';

    if (!rawImageUrl) {
      return jsonResponse({ error: 'Keine Bild-URL übergeben.' }, 400);
    }
    if (rawImageUrl.startsWith('data:image/')) {
      return jsonResponse(
        { error: 'Bitte Vercel Blob aktivieren (BLOB_READ_WRITE_TOKEN), damit neue Bilder eine öffentliche URL erhalten.' },
        400
      );
    }

    const publicImageUrl = resolvePublicImageUrl(rawImageUrl, request);

    // 1. Container erstellen
    const createRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        image_url: publicImageUrl,
        caption,
        access_token: accessToken,
      }),
    });
    const createData = await createRes.json().catch(() => ({}));
    if (!createRes.ok || !createData.id) {
      console.error('Meta /media error:', createData);
      throw new Error(createData?.error?.message || `Meta /media HTTP ${createRes.status}`);
    }
    const creationId = createData.id;

    // 2. Warten bis Meta das Bild verarbeitet hat
    for (let i = 0; i < 12; i++) {
      const statusUrl = `${GRAPH_BASE}/${encodeURIComponent(creationId)}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`;
      const statusRes = await fetch(statusUrl);
      const statusData = await statusRes.json().catch(() => ({}));
      if (statusData.status_code === 'FINISHED') break;
      if (statusData.status_code === 'ERROR') {
        throw new Error(`Instagram Medienverarbeitung fehlgeschlagen: ${statusData.status || 'ERROR'}`);
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    // 3. Veröffentlichen
    const pubRes = await fetch(`${GRAPH_BASE}/${encodeURIComponent(igUserId)}/media_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creation_id: creationId,
        access_token: accessToken,
      }),
    });
    const pubData = await pubRes.json().catch(() => ({}));
    if (!pubRes.ok || !pubData.id) {
      console.error('Meta /media_publish error:', pubData);
      throw new Error(pubData?.error?.message || `Meta /media_publish HTTP ${pubRes.status}`);
    }

    return jsonResponse({
      status: 'success',
      media_id: pubData.id,
      creation_id: creationId,
      public_image_url: publicImageUrl,
    });
  } catch (err) {
    console.error('publish-instagram POST error:', err);
    return jsonResponse({ error: err.message || 'Instagram-Veröffentlichung fehlgeschlagen.' }, 502);
  }
}
