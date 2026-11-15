import { jsonResponse, requireAuth } from '../lib/auth.js';
import { getMonthlyUsage, incrementMonthlyUsage, uploadImageBuffer } from '../lib/storage.js';

async function generateWithNanoBanana(prompt, apiKey) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent';
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio: '1:1',
        imageSize: '2K',
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(55000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Nano Banana HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const result = await res.json();
  const parts = result?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      return Buffer.from(inline.data, 'base64');
    }
  }
  throw new Error('Nano Banana lieferte keine Bilddaten.');
}

async function generateWithPollinations(prompt, seed) {
  const encoded = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=${seed}&model=flux`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Heizmobil-InstaStudio/2.0' },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    throw new Error(`Pollinations HTTP ${res.status}`);
  }
  const arrBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrBuf);
  if (buf.length < 5000) {
    throw new Error('Pollinations Bild zu klein.');
  }
  return buf;
}

export async function POST(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const prompt = body.prompt || '';
    const week = Number(body.scheduled_week || 1);
    const varIdx = Number(body.variation_index || 1);

    if (!prompt.trim()) {
      return jsonResponse({ error: 'Prompt fehlt.' }, 400);
    }

    // Hard server-side cap to protect Google Cloud / AI Studio budget
    const currentUsage = await getMonthlyUsage();
    if (currentUsage.nano_banana_used >= currentUsage.monthly_limit) {
      return jsonResponse(
        {
          error: `Das monatliche Bilder-Limit (${currentUsage.monthly_limit} Bilder) ist für diesen Monat erreicht.`,
          limit_reached: true,
          usage: currentUsage,
        },
        429
      );
    }

    let imgBuffer = null;
    let source = null;

    const apiKey = process.env.GEMINI_API_KEY || '';
    if (apiKey) {
      try {
        imgBuffer = await generateWithNanoBanana(prompt, apiKey);
        source = 'nano_banana';
      } catch (err) {
        console.error('Nano Banana generation error:', err);
      }
    }

    if (!imgBuffer) {
      try {
        const seed = Math.floor(Date.now() % 100000);
        imgBuffer = await generateWithPollinations(prompt, seed);
        source = 'pollinations';
      } catch (err) {
        console.error('Pollinations fallback error:', err);
      }
    }

    if (!imgBuffer) {
      return jsonResponse({ error: 'Bildgenerierung fehlgeschlagen.' }, 502);
    }

    const weekStr = String(week).padStart(2, '0');
    const ts = Math.floor(Date.now() / 1000);
    const filename = `w${weekStr}_var${varIdx}_${ts}.jpg`;

    const blobUrl = await uploadImageBuffer(filename, imgBuffer, 'image/jpeg');
    const dataUrl = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;
    const usage = await incrementMonthlyUsage(source);

    return jsonResponse({
      status: 'success',
      source,
      filename,
      image_url: blobUrl || dataUrl,
      image_data_url: blobUrl ? undefined : dataUrl,
      usage,
    });
  } catch (err) {
    console.error('generate-image POST error:', err);
    return jsonResponse({ error: err.message || 'Unbekannter Fehler' }, 500);
  }
}
