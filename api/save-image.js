import { jsonResponse, requireAuth } from '../lib/auth.js';
import { uploadImageBuffer } from '../lib/storage.js';

export async function POST(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const dataUrl = body.image_data_url || '';
    const week = Number(body.scheduled_week || 1);
    const varIdx = Number(body.variation_index || 1);

    if (!dataUrl.includes(';base64,')) {
      return jsonResponse({ error: 'Ungültige Bilddaten.' }, 400);
    }

    const [header, b64] = dataUrl.split(';base64,');
    const mimeType = header.includes('png') ? 'image/png' : 'image/jpeg';
    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    const weekStr = String(week).padStart(2, '0');
    const ts = Math.floor(Date.now() / 1000);
    const filename = `w${weekStr}_var${varIdx}_${ts}.${ext}`;

    const buffer = Buffer.from(b64, 'base64');
    const blobUrl = await uploadImageBuffer(filename, buffer, mimeType);

    return jsonResponse({
      status: 'success',
      filename,
      image_url: blobUrl || dataUrl,
    });
  } catch (err) {
    console.error('save-image POST error:', err);
    return jsonResponse({ error: err.message || 'Bild konnte nicht gespeichert werden.' }, 500);
  }
}
