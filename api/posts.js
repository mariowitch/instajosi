import fs from 'node:fs/promises';
import path from 'node:path';
import { jsonResponse, requireAuth } from '../lib/auth.js';
import { getPostOverrides, savePostOverride } from '../lib/storage.js';

export async function GET(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const filePath = path.join(process.cwd(), 'content_plan_heizmobil_q1.json');
    const raw = await fs.readFile(filePath, 'utf8');
    const posts = JSON.parse(raw);
    const overrides = await getPostOverrides();

    const merged = posts.map((post) => {
      const ov = overrides[post.post_id];
      return ov ? { ...post, ...ov } : post;
    });

    return jsonResponse(merged);
  } catch (err) {
    console.error('Posts GET error:', err);
    return jsonResponse({ error: 'Inhaltsplan konnte nicht geladen werden.' }, 500);
  }
}

export async function POST(request) {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const body = await request.json();
    const postId = body.post_id;
    if (!postId || typeof postId !== 'string') {
      return jsonResponse({ error: 'post_id fehlt.' }, 400);
    }

    const allowedFields = [
      'topic',
      'target_location',
      'caption',
      'image_prompt',
      'image_url',
      'is_regenerated',
      'variation_index',
    ];
    const patch = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        patch[key] = body[key];
      }
    }

    const saved = await savePostOverride(postId, patch);
    return jsonResponse({ status: 'ok', persisted_remotely: saved });
  } catch (err) {
    console.error('Posts POST error:', err);
    return jsonResponse({ error: 'Änderungen konnten nicht gespeichert werden.' }, 500);
  }
}
