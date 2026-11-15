#!/usr/bin/env python3
"""
HEIZMOBIL INSTASTUDIO - LOCAL SERVER
Serves the web application and handles JSON API endpoints.
Includes Gemini / Imagen 3 image generation proxy.
"""

import http.server
import socketserver
import json
import os
import sys
import urllib.request
import urllib.error
import threading
from datetime import datetime

PORT = 8085
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
USAGE_PATH = os.path.join(DIRECTORY, 'usage_stats.json')
USAGE_LOCK = threading.Lock()
DEFAULT_MONTHLY_LIMIT = 74  # ~$10/mo AI Pro credits ÷ ~$0.134 per Nano Banana Pro 2K image
class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

# Load API config from config.json (never expose in client-side code)
CONFIG_PATH = os.path.join(DIRECTORY, 'config.json')

def load_config():
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"⚠️  config.json nicht gefunden oder ungültig: {e}")
        return {}

_init_cfg = load_config()
GEMINI_API_KEY = _init_cfg.get('gemini_api_key', '')
if GEMINI_API_KEY:
    print("✅ Gemini API Key geladen aus config.json")
else:
    print("⚠️  Kein Gemini API Key in config.json gefunden")


def get_monthly_usage():
    """Returns current month's image generation counts and remaining allowance."""
    month_key = datetime.now().strftime('%Y-%m')
    cfg = load_config()
    try:
        monthly_limit = int(cfg.get('monthly_nano_banana_limit') or DEFAULT_MONTHLY_LIMIT)
    except (TypeError, ValueError):
        monthly_limit = DEFAULT_MONTHLY_LIMIT

    with USAGE_LOCK:
        stats = {}
        if os.path.exists(USAGE_PATH):
            try:
                with open(USAGE_PATH, 'r', encoding='utf-8') as f:
                    stats = json.load(f)
            except Exception:
                stats = {}
        entry = stats.get(month_key, {"nano_banana": 0, "pollinations": 0})
        nb_used = int(entry.get("nano_banana", 0))
        poll_used = int(entry.get("pollinations", 0))

    return {
        "month": month_key,
        "nano_banana_used": nb_used,
        "pollinations_used": poll_used,
        "monthly_limit": monthly_limit,
        "remaining": max(0, monthly_limit - nb_used),
    }


def increment_monthly_usage(source):
    """Thread-safely increments this month's counter in usage_stats.json."""
    month_key = datetime.now().strftime('%Y-%m')
    with USAGE_LOCK:
        stats = {}
        if os.path.exists(USAGE_PATH):
            try:
                with open(USAGE_PATH, 'r', encoding='utf-8') as f:
                    stats = json.load(f)
            except Exception:
                stats = {}
        entry = stats.get(month_key, {"nano_banana": 0, "pollinations": 0})
        key = "nano_banana" if source == "nano_banana" else "pollinations"
        entry[key] = int(entry.get(key, 0)) + 1
        stats[month_key] = entry
        with open(USAGE_PATH, 'w', encoding='utf-8') as f:
            json.dump(stats, f, indent=2)
    return get_monthly_usage()


def fix_image_orientation(image_bytes):
    """
    Validates image bytes and corrects EXIF orientation so images are never
    upside-down, sideways, or corrupted HTML error pages.
    Returns corrected JPEG bytes, or raises ValueError if bytes are not an image.
    """
    if not image_bytes or len(image_bytes) < 512:
        raise ValueError(f"Ungültige Bilddaten empfangen ({len(image_bytes) if image_bytes else 0} Bytes)")

    from PIL import Image, ImageOps
    import io
    img = Image.open(io.BytesIO(image_bytes))
    img.load()  # Verify full image payload is readable and not truncated
    img = ImageOps.exif_transpose(img)
    if img.mode in ('RGBA', 'P', 'LA'):
        img = img.convert('RGB')
    out = io.BytesIO()
    img.save(out, format='JPEG', quality=92, optimize=True)
    corrected = out.getvalue()
    print(f"✅ Bild validiert & EXIF korrigiert: {len(image_bytes)} → {len(corrected)} Bytes")
    return corrected


def generate_image_via_pollinations(prompt, seed=42, width=1024, height=1024):
    """
    Fetches a real AI-generated image from Pollinations.ai (free, no key needed).
    Uses the Flux model. Returns a base64 DataURL with corrected orientation.
    """
    import base64
    import urllib.parse

    encoded_prompt = urllib.parse.quote(prompt)
    url = (
        f"https://image.pollinations.ai/prompt/{encoded_prompt}"
        f"?width={width}&height={height}&model=flux&seed={seed}"
        f"&nologo=true&enhance=true"
    )
    print(f"🌐 Pollinations.ai: seed={seed}, {width}x{height}")

    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'HeizmobilInstaStudio/1.0')

    with urllib.request.urlopen(req, timeout=60) as response:
        image_bytes = response.read()
        print(f"📥 Empfangen: {len(image_bytes)} Bytes")

    # Fix EXIF orientation before returning
    image_bytes = fix_image_orientation(image_bytes)

    b64 = base64.b64encode(image_bytes).decode('utf-8')
    return f"data:image/jpeg;base64,{b64}", image_bytes



def generate_image_nano_banana(prompt, api_key, resolution="2K"):
    """
    Nano Banana = Google Gemini native image generation.
    Tries models in quality order:
      1. gemini-3-pro-image          (Nano Banana Pro  – best, 2K/4K)
      2. gemini-3.1-flash-image      (Nano Banana 2    – fast, 2K/4K)
      3. gemini-2.5-flash-image      (Nano Banana 1    – standard)
      4. gemini-3.1-flash-lite-image (Nano Banana 2 Lite – fastest)
    Returns (data_url, fixed_bytes) or raises.
    """
    import base64

    nano_banana_models = [
        ("gemini-3-pro-image",          "Nano Banana Pro",      True),
        ("gemini-3.1-flash-image",      "Nano Banana 2",        True),
        ("gemini-2.5-flash-image",      "Nano Banana Flash",    False),
        ("gemini-3.1-flash-lite-image", "Nano Banana 2 Lite",   True),
    ]

    last_error = None
    for model_id, model_name, supports_size in nano_banana_models:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_id}:generateContent?key={api_key}"
        )
        img_cfg = {"aspectRatio": "1:1"}
        if supports_size and resolution in ("1K", "2K", "4K"):
            img_cfg["imageSize"] = resolution

        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["IMAGE", "TEXT"],
                "imageConfig": img_cfg,
            }
        }
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(url, data=data, method='POST')
        req.add_header('Content-Type', 'application/json')

        try:
            print(f"🍌 Versuche {model_name} ({resolution})...")
            with urllib.request.urlopen(req, timeout=60) as response:
                result = json.loads(response.read().decode('utf-8'))
                candidates = result.get('candidates', [])
                for candidate in candidates:
                    parts = candidate.get('content', {}).get('parts', [])
                    for part in parts:
                        if 'inlineData' in part:
                            b64_raw = part['inlineData'].get('data', '')
                            if b64_raw:
                                raw_bytes = base64.b64decode(b64_raw)
                                fixed_bytes = fix_image_orientation(raw_bytes)
                                b64_fixed = base64.b64encode(fixed_bytes).decode('utf-8')
                                print(f"✅ {model_name} erfolgreich! {len(fixed_bytes)//1024}KB")
                                return f"data:image/jpeg;base64,{b64_fixed}", fixed_bytes
        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8')
            print(f"⚠️ {model_name} HTTP {e.code}: {err_body[:140]}")
            last_error = f"{model_name} HTTP {e.code}"
            # Fast-fail on account-wide billing / invalid key errors so fallback starts immediately
            if e.code in (401, 402, 403):
                break
            continue
        except Exception as e:
            print(f"⚠️ {model_name} Fehler: {e}")
            last_error = str(e)
            continue

    raise Exception(f"Nano Banana nicht verfügbar ({last_error})")


def publish_to_instagram_graph(image_url, caption, ig_user_id, access_token):
    """
    Publishes a single image post to Instagram via the official Meta Graph API (v21.0):
      1. POST /{ig_user_id}/media         -> creates media container
      2. GET  /{creation_id}?fields=...   -> waits until container status is FINISHED
      3. POST /{ig_user_id}/media_publish -> publishes container to the feed
    """
    import time
    import urllib.parse

    graph_base = "https://graph.facebook.com/v21.0"

    # Step 1: Create media container
    create_url = f"{graph_base}/{urllib.parse.quote(ig_user_id)}/media"
    create_payload = urllib.parse.urlencode({
        "image_url": image_url,
        "caption": caption,
        "access_token": access_token
    }).encode('utf-8')

    req1 = urllib.request.Request(create_url, data=create_payload, method='POST')
    try:
        with urllib.request.urlopen(req1, timeout=30) as r1:
            res1 = json.loads(r1.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        raise Exception(f"Meta Container Fehler (HTTP {e.code}): {err_body}")

    creation_id = res1.get("id")
    if not creation_id:
        raise Exception(f"Keine creation_id von Meta erhalten: {res1}")

    # Step 2: Poll container status briefly until FINISHED
    status_url = (
        f"{graph_base}/{urllib.parse.quote(creation_id)}"
        f"?fields=status_code&access_token={urllib.parse.quote(access_token)}"
    )
    for _ in range(10):
        try:
            with urllib.request.urlopen(status_url, timeout=15) as rs:
                st = json.loads(rs.read().decode('utf-8'))
                code = st.get("status_code")
                if code == "FINISHED":
                    break
                if code in ("ERROR", "EXPIRED"):
                    raise Exception(f"Meta Container Status: {code}")
        except urllib.error.HTTPError:
            break
        time.sleep(1.5)

    # Step 3: Publish container
    pub_url = f"{graph_base}/{urllib.parse.quote(ig_user_id)}/media_publish"
    pub_payload = urllib.parse.urlencode({
        "creation_id": creation_id,
        "access_token": access_token
    }).encode('utf-8')

    req2 = urllib.request.Request(pub_url, data=pub_payload, method='POST')
    try:
        with urllib.request.urlopen(req2, timeout=30) as r2:
            res2 = json.loads(r2.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8')
        raise Exception(f"Meta Publish Fehler (HTTP {e.code}): {err_body}")

    media_id = res2.get("id")
    if not media_id:
        raise Exception(f"Keine media_id von Meta erhalten: {res2}")

    return {"creation_id": creation_id, "media_id": media_id}


class HeizmobilHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        clean_path = self.path.split('?', 1)[0]
        if clean_path == '/api/posts':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            json_file_path = os.path.join(DIRECTORY, 'content_plan_heizmobil_q1.json')
            if os.path.exists(json_file_path):
                with open(json_file_path, 'r', encoding='utf-8') as f:
                    self.wfile.write(f.read().encode('utf-8'))
            else:
                self.wfile.write(json.dumps([]).encode('utf-8'))
            return

        if clean_path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            cfg = load_config()
            status = {
                "server": "ok",
                "gemini_api_key": "configured" if (cfg.get("gemini_api_key") or GEMINI_API_KEY) else "missing",
                "instagram_configured": bool(cfg.get("instagram_account_id") and cfg.get("instagram_access_token")),
                "public_base_url_configured": bool(cfg.get("public_base_url")),
                "usage": get_monthly_usage(),
                "port": PORT
            }
            self.wfile.write(json.dumps(status).encode('utf-8'))
            return

        if clean_path == '/api/usage':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(get_monthly_usage()).encode('utf-8'))
            return

        return super().do_GET()

    def do_POST(self):

        # ── AI Image Generation: Pollinations.ai (primary) + Gemini (fallback) ──
        if self.path == '/api/generate-image':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode('utf-8'))

                prompt = data.get('prompt', 'A photorealistic alpine winter scene in Bavaria')
                week = data.get('scheduled_week', 1)
                var_index = data.get('variation_index', 1)

                import time, base64
                seed = int(week) * 1000 + int(var_index) * 137 + int(time.time()) % 9999
                ts = int(time.time())

                print(f"🎨 Generiere KI-Bild: Woche {week}, Var {var_index}, Seed {seed}")
                print(f"   Prompt: {prompt[:100]}...")

                image_data_url = None
                image_bytes = None
                source = "pollinations"

                # ── 1. Nano Banana (Gemini native – beste Qualität) ────────
                if GEMINI_API_KEY:
                    try:
                        image_data_url, image_bytes = generate_image_nano_banana(
                            prompt, GEMINI_API_KEY, resolution="2K"
                        )
                        source = "nano_banana"
                    except Exception as nb_err:
                        print(f"⚠️ Nano Banana fehlgeschlagen: {nb_err}")

                # ── 2. Pollinations.ai Fallback (kostenlos, kein Key) ──────
                if not image_data_url:
                    print("🔄 Fallback: Pollinations.ai...")
                    try:
                        image_data_url, image_bytes = generate_image_via_pollinations(
                            prompt, seed=seed, width=1024, height=1024
                        )
                        source = "pollinations"
                    except Exception as poll_err:
                        print(f"⚠️ Pollinations fehlgeschlagen: {poll_err}")

                if not image_data_url:
                    raise Exception("Weder Nano Banana noch Pollinations konnten ein Bild liefern.")

                filename = f"{source}_w{int(week):02d}_var{var_index}_{ts}.jpg"

                # Save to /images/ on disk
                if image_bytes:
                    images_dir = os.path.join(DIRECTORY, 'images')
                    os.makedirs(images_dir, exist_ok=True)
                    filepath = os.path.join(images_dir, filename)
                    with open(filepath, 'wb') as f:
                        f.write(image_bytes)
                    print(f"💾 Gespeichert [{source}]: {filepath}")

                usage = increment_monthly_usage(source)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                res = {
                    "status": "success",
                    "image_url": f"images/{filename}",
                    "image_data_url": image_data_url,
                    "filename": filename,
                    "source": source,
                    "usage": usage
                }
                self.wfile.write(json.dumps(res).encode('utf-8'))
                return


            except Exception as e:
                print(f"❌ Fehler bei Bildgenerierung: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return

        # ── Save Image to Disk ─────────────────────────────────────────
        if self.path == '/api/save-image':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode('utf-8'))

                image_data_url = data.get('image_data_url', '')
                week = data.get('scheduled_week', 1)
                var_index = data.get('variation_index', 1)

                if image_data_url and ',' in image_data_url:
                    import base64, time
                    header, encoded = image_data_url.split(',', 1)
                    image_bytes = base64.b64decode(encoded)

                    images_dir = os.path.join(DIRECTORY, 'images')
                    os.makedirs(images_dir, exist_ok=True)

                    filename = f"gen_w{int(week):02d}_var{var_index}_{int(time.time())}.jpg"
                    filepath = os.path.join(images_dir, filename)

                    with open(filepath, 'wb') as f:
                        f.write(image_bytes)

                    print(f"💾 Bild auf Disk gespeichert: {filepath}")

                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    res = {"status": "success", "image_url": f"images/{filename}", "filename": filename}
                    self.wfile.write(json.dumps(res).encode('utf-8'))
                    return
            except Exception as e:
                print(f"❌ Fehler beim Speichern: {e}")
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return

        # ── Publish directly to Instagram Graph API ─────────────────────
        if self.path == '/api/publish-instagram':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode('utf-8'))

                cfg = load_config()
                ig_user_id = (cfg.get('instagram_account_id') or '').strip()
                ig_token = (cfg.get('instagram_access_token') or '').strip()
                public_base = (cfg.get('public_base_url') or '').strip().rstrip('/')

                if not ig_user_id or not ig_token:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "error": "Instagram Credentials fehlen in config.json (instagram_account_id & instagram_access_token)."
                    }).encode('utf-8'))
                    return

                raw_image_url = (data.get('image_url') or '').strip()
                caption = (data.get('caption') or '').strip()
                if not raw_image_url or not caption:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "error": "image_url und caption sind erforderlich."
                    }).encode('utf-8'))
                    return

                if raw_image_url.startswith('https://'):
                    public_image_url = raw_image_url
                else:
                    rel_path = raw_image_url.lstrip('/')
                    abs_file = os.path.abspath(os.path.join(DIRECTORY, rel_path))
                    if not abs_file.startswith(os.path.abspath(DIRECTORY)) or not os.path.exists(abs_file):
                        self.send_response(400)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps({
                            "error": f"Lokale Bilddatei nicht gefunden: {rel_path}"
                        }).encode('utf-8'))
                        return

                    if not public_base.startswith('https://'):
                        self.send_response(400)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        self.wfile.write(json.dumps({
                            "error": "public_base_url (https://...) fehlt in config.json. Meta muss das Bild über eine öffentliche HTTPS-URL abrufen können (z. B. via cloudflared/ngrok Tunnel auf localhost:8085)."
                        }).encode('utf-8'))
                        return

                    public_image_url = f"{public_base}/{rel_path}"

                print(f"📲 Poste auf Instagram ({ig_user_id}): {public_image_url}")
                result = publish_to_instagram_graph(public_image_url, caption, ig_user_id, ig_token)
                print(f"✅ Instagram Post veröffentlicht! media_id={result['media_id']}")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "status": "success",
                    "media_id": result["media_id"],
                    "creation_id": result["creation_id"]
                }).encode('utf-8'))
                return

            except Exception as e:
                print(f"❌ Instagram Publish Fehler: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return

        # ── Webhook Test ────────────────────────────────────────────────
        if self.path == '/api/webhook-test':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            print(f"Webhook payload: {body.decode('utf-8')}")
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success"}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        # Suppress noisy GET logs for static files, show only API calls
        if '/api/' in args[0] if args else False:
            super().log_message(format, *args)


def run_server():
    os.chdir(DIRECTORY)
    with ThreadedTCPServer(("", PORT), HeizmobilHandler) as httpd:
        print(f"==================================================")
        print(f"🏔️  Heizmobil InstaStudio Server Running (Multi-Threaded)!")
        print(f"📍  Open: http://localhost:{PORT}")
        print(f"🍌  Nano Banana API Key: {'✅ Configured' if GEMINI_API_KEY else '❌ Missing (Pollinations Fallback)'}")
        print(f"==================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping server...")
            httpd.server_close()


if __name__ == "__main__":
    run_server()
