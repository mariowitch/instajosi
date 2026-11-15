/**
 * HEIZMOBIL INSTASTUDIO - CLIENT APPLICATION LOGIC
 * Management, Preview & Automation Suite for Instagram Content Plan
 */

// Initial Data Fallback (13 Weeks Plan)
let contentData = [];
let activePostId = "heizmobil_q1_w01";

// Load Data on Initialization
document.addEventListener("DOMContentLoaded", async () => {
  await loadContentPlan();
  setupEventListeners();
  renderDateInfo();
  refreshUsageCounter();
  renderGrid();
  renderList();
  selectPost(activePostId);
});

// Calculate & Display Current Date and Calendar Week (ISO-8601)
function getCalendarWeek(date) {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNumber = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  return 1 + Math.round((firstThursday - target) / 604800000);
}

function renderDateInfo() {
  const currentDate = new Date();
  const kw = getCalendarWeek(currentDate);

  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const formattedDate = currentDate.toLocaleDateString('de-DE', options);

  const dateChip = document.getElementById("dateStatChip");
  if (dateChip) {
    dateChip.innerHTML = `📅 Heute: <strong>${formattedDate}</strong> <span style="margin: 0 4px; color: var(--grasegger-gold);">|</span> <strong>KW ${kw}</strong>`;
  }
}

// Render & Update Monthly Nano Banana Image Generation Counter
function updateUsageChip(usage) {
  const chip = document.getElementById("usageStatChip");
  if (!chip || !usage) return;

  const used = Number(usage.nano_banana_used || 0);
  const limit = Number(usage.monthly_limit || 74);
  const remaining = Math.max(0, limit - used);
  const isLow = remaining <= 10;

  chip.style.borderColor = isLow ? "var(--grasegger-red)" : "";
  chip.innerHTML = `🍌 Monat (${usage.month}): <strong>${used} / ~${limit}</strong> <span style="margin: 0 4px; color: var(--grasegger-gold);">|</span> <strong style="color: ${isLow ? 'var(--grasegger-red)' : 'var(--grasegger-green)'};">${remaining} übrig</strong>`;
  chip.title = `Dieses Monat über Nano Banana generiert: ${used} von ~${limit} Bildern (~$10/Mo AI-Pro-Budget). Fallback-Bilder (Pollinations): ${usage.pollinations_used || 0}.`;
}

async function refreshUsageCounter() {
  try {
    const res = await fetch('/api/usage');
    if (res.ok) {
      const usage = await res.json();
      updateUsageChip(usage);
    }
  } catch (err) {
    console.warn("⚠️ Konnte Monatszähler nicht laden:", err.message);
  }
}

// Calculate Scheduled Date for Each Week starting from the current week
function getPostScheduledDate(weekNumber) {
  const baseDate = new Date();
  const daysToAdd = (weekNumber - 1) * 7;
  const postDate = new Date(baseDate);
  postDate.setDate(baseDate.getDate() + daysToAdd);

  const postKw = getCalendarWeek(postDate);
  const dateString = postDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  return { dateString, kw: postKw };
}

// Setup Event Listeners
function setupEventListeners() {
  // Tab Switching
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      e.target.classList.add("active");

      const targetTab = e.target.getAttribute("data-tab");
      if (targetTab === "grid") {
        document.getElementById("gridView").style.display = "grid";
        document.getElementById("listView").style.display = "none";
      } else {
        document.getElementById("gridView").style.display = "none";
        document.getElementById("listView").style.display = "flex";
      }
    });
  });

  // Action Bar Controls
  document.getElementById("btnRegeneratePost")?.addEventListener("click", () => regeneratePost(activePostId));
  document.getElementById("btnDownloadImage")?.addEventListener("click", () => downloadPostImage(activePostId));
  document.getElementById("btnPublishInstagram")?.addEventListener("click", () => publishToInstagram(activePostId));
  document.getElementById("btnMediaOverlayDownload")?.addEventListener("click", () => downloadPostImage(activePostId));
  document.getElementById("btnEditPost")?.addEventListener("click", openEditModal);
  document.getElementById("btnCloseModal")?.addEventListener("click", closeModal);
  document.getElementById("editForm")?.addEventListener("submit", handleFormSave);

  // Copy & Export Controls
  document.getElementById("btnCopyCaption")?.addEventListener("click", copyCaption);
  document.getElementById("btnCopyPrompt")?.addEventListener("click", togglePromptPreview);
  document.getElementById("btnCopyPromptInner")?.addEventListener("click", copyPrompt);
  document.getElementById("btnExportJson")?.addEventListener("click", exportJson);
  document.getElementById("btnExportCsv")?.addEventListener("click", exportCsv);
  document.getElementById("btnTestWebhook")?.addEventListener("click", testWebhook);
}

// Fetch Data from JSON File or LocalStorage
async function loadContentPlan() {
  const savedData = localStorage.getItem("heizmobil_insta_plan_v3");
  if (savedData) {
    try {
      const parsed = JSON.parse(savedData);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Sanitize any stale/corrupted image_url entries from older sessions
        contentData = parsed.map((p) => {
          if (p.image_url && typeof p.image_url === "string") {
            const valid = p.image_url.startsWith("images/") || p.image_url.startsWith("data:image/jpeg;base64,/9j/");
            if (!valid) delete p.image_url;
          } else {
            delete p.image_url;
          }
          return p;
        });
        console.log("Loaded & sanitized content plan from LocalStorage v3.");
        return;
      }
    } catch (e) {
      console.error("Error parsing LocalStorage data, loading JSON...", e);
    }
  }

  try {
    const response = await fetch("content_plan_heizmobil_q1.json");
    contentData = await response.json();
    console.log("Loaded content plan from JSON file.");
  } catch (err) {
    console.error("Could not fetch JSON file, using fallback...", err);
  }
}

// Safely persist contentData without crashing on LocalStorage 5MB quota
function persistToLocalStorage() {
  try {
    localStorage.setItem("heizmobil_insta_plan_v3", JSON.stringify(contentData));
  } catch (quotaErr) {
    console.warn("⚠️ LocalStorage voll – bereinige Inline-Base64-Bilder...", quotaErr);
    try {
      const compact = contentData.map((p) => {
        const copy = { ...p };
        if (copy.image_url && copy.image_url.startsWith("data:image/")) {
          delete copy.image_url;
        }
        return copy;
      });
      localStorage.setItem("heizmobil_insta_plan_v3", JSON.stringify(compact));
    } catch (e2) {
      console.error("❌ Konnte LocalStorage nicht beschreiben:", e2);
    }
  }
}

// Save Data to LocalStorage
function saveContentPlan() {
  persistToLocalStorage();
  showToast("Plan lokal gespeichert! 💾");
}

// Expanded High-Resolution Photorealistic Photo Sources
const REAL_PHOTO_PATHS = [
  "images/nano_banana/w01_var1.jpg", "images/nano_banana/w02_var1.jpg", "images/nano_banana/w03_var1.jpg",
  "images/nano_banana/w04_var1.jpg", "images/nano_banana/w05_var1.jpg", "images/nano_banana/w06_var1.jpg",
  "images/nano_banana/w07_var1.jpg", "images/nano_banana/w08_var1.jpg", "images/nano_banana/w09_var1.jpg",
  "images/nano_banana/w10_var1.jpg", "images/nano_banana/w11_var1.jpg", "images/nano_banana/w12_var1.jpg",
  "images/nano_banana/w13_var1.jpg"
];

// Seeded pseudo-random number generator (mulberry32)
function makePRNG(seed) {
  let s = seed >>> 0;
  return function() {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Call Nano Banana / Pollinations via local server proxy → true AI-generated photo
async function generateRealAiPhotoAsync(post) {
  const prompt = post.image_prompt ||
    `Photorealistic 8K photo: Rupp Grasegger Heizmobil mobile heating unit in ${post.target_location || 'Garmisch-Partenkirchen'}, ${post.topic || 'alpine winter scene'}, Bavarian Alps, dramatic mountain light, professional photography, upright orientation, no watermark`;

  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        scheduled_week: post.scheduled_week || 1,
        variation_index: post.variation_index || 1
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.usage) {
        updateUsageChip(data.usage);
      }
      if (data.image_url || data.image_data_url) {
        const src = data.source === 'nano_banana' ? '🍌 Nano Banana' : '🌐 Pollinations';
        console.log(`✅ ${src} Bild erhalten! (${data.filename})`);
        // Prefer clean disk path (already saved by /api/generate-image) to avoid LocalStorage overflow
        return data.image_url || data.image_data_url;
      }
    } else {
      const err = await res.json().catch(() => ({}));
      console.warn('⚠️ Bild-API Fehler:', err.error || res.status);
    }
  } catch (err) {
    console.warn('⚠️ Server nicht erreichbar, nutze Canvas-Fallback:', err.message);
  }

  // Fallback: Canvas-Composite aus lokalem Nano-Banana-Basisfoto
  return generateCanvasFallback(post);
}

// Canvas-Composite Fallback (lokale Basisfotos + Filter)
function generateCanvasFallback(post) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");

    const topic = post.topic || "Heizmobil Werdenfels";
    const location = post.target_location || "Garmisch-Partenkirchen";
    const varIndex = post.variation_index || 1;

    const tsSalt = post._ts ? (post._ts % 99991) : Math.floor(Math.random() * 10000);
    const seed = ((post.scheduled_week || 1) * 1000) + (varIndex * 137) + topic.length * 31 + tsSalt;
    const rng = makePRNG(seed);

    const photoIndex = Math.floor(rng() * REAL_PHOTO_PATHS.length);
    const photoPath = REAL_PHOTO_PATHS[photoIndex];

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      ctx.save();
      const zoom = 1.0 + rng() * 0.35;
      const sw = img.naturalWidth / zoom;
      const sh = img.naturalHeight / zoom;
      const sx = (img.naturalWidth - sw) * rng();
      const sy = (img.naturalHeight - sh) * rng();

      if (rng() > 0.5) { ctx.translate(800, 0); ctx.scale(-1, 1); }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 800, 800);
      ctx.restore();

      const filterStyles = [
        () => { const g = ctx.createRadialGradient(700,100,10,700,100,700); g.addColorStop(0,"rgba(255,200,100,0.4)"); g.addColorStop(1,"rgba(0,0,0,0)"); ctx.fillStyle=g; ctx.fillRect(0,0,800,800); },
        () => { const g = ctx.createLinearGradient(0,0,0,800); g.addColorStop(0,"rgba(56,189,248,0.12)"); g.addColorStop(1,"rgba(15,23,42,0.25)"); ctx.fillStyle=g; ctx.fillRect(0,0,800,800); },
        () => { const g = ctx.createRadialGradient(400,400,200,400,400,600); g.addColorStop(0,"rgba(245,158,11,0.1)"); g.addColorStop(1,"rgba(15,23,42,0.35)"); ctx.fillStyle=g; ctx.fillRect(0,0,800,800); }
      ];
      filterStyles[Math.floor(rng() * filterStyles.length)]();

      const vignette = ctx.createRadialGradient(400,400,320,400,400,560);
      vignette.addColorStop(0,"rgba(0,0,0,0)");
      vignette.addColorStop(1,"rgba(0,0,0,0.5)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0,0,800,800);

      ctx.fillStyle = "rgba(15,23,42,0.84)"; ctx.fillRect(0,715,800,85);
      ctx.fillStyle = "#B91C1C"; ctx.fillRect(0,715,6,85);
      ctx.fillStyle = "#F59E0B"; ctx.font = "bold 16px 'Inter',sans-serif";
      ctx.fillText(`📍 ${location}`, 24, 746);
      const topicShort = topic.length > 42 ? topic.slice(0,39)+"…" : topic;
      ctx.fillStyle = "#FFFFFF"; ctx.font = "bold 19px Georgia,serif";
      ctx.fillText(topicShort, 24, 776);

      resolve(canvas.toDataURL("image/jpeg", 0.94));
    };

    img.onerror = () => resolve(photoPath);
    img.src = photoPath;
  });
}


function generateRealAiPhoto(post) {
  const weekNum = String(post.scheduled_week || 1).padStart(2, '0');
  return `images/w${weekNum}.jpg`;
}

function createNanoBananaVisual(post) {
  return generateRealAiPhoto(post);
}

function escapeXml(str) {
  return str.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}

// Determine Image URL for a Post
function getPostImageUrl(post) {
  if (post.is_regenerated && post.image_url) {
    return post.image_url;
  }
  if (post.image_url && (post.image_url.startsWith("data:image/") || post.image_url.startsWith("images/"))) {
    return post.image_url;
  }

  // Default to high-resolution Nano Banana photo for the week
  const weekNum = String(post.scheduled_week || 1).padStart(2, '0');
  return `images/nano_banana/w${weekNum}_var1.jpg`;
}

function getFallbackImageUrl(post) {
  const weekNum = String(post.scheduled_week || 1).padStart(2, '0');
  return `images/nano_banana/w${weekNum}_var1.jpg`;
}

// Download High-Resolution Post Image (JPEG/PNG)
function downloadPostImage(postId) {
  const targetId = postId || activePostId;
  const post = contentData.find((p) => p.post_id === targetId);
  if (!post) return;

  const imageUrl = getPostImageUrl(post);
  const weekStr = String(post.scheduled_week).padStart(2, '0');
  const safeTopic = (post.topic || 'Foto').replace(/[^a-zA-Z0-9äöüÄÖÜß_-]/g, '_');
  const fileName = `Heizmobil_KW${weekStr}_${safeTopic}.jpg`;

  const link = document.createElement("a");
  link.href = imageUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast(`📥 High-Res Foto heruntergeladen: ${fileName}`);
}

// Render 3x3 Grid View
function renderGrid() {
  const gridContainer = document.getElementById("gridView");
  if (!gridContainer) return;

  gridContainer.innerHTML = contentData.map((post) => {
    const dateInfo = getPostScheduledDate(post.scheduled_week);
    const imgUrl = getPostImageUrl(post);
    const fallbackUrl = getFallbackImageUrl(post);
    return `
      <div class="grid-card ${post.post_id === activePostId ? 'active' : ''}" onclick="selectPost('${post.post_id}')">
        <div class="grid-image-wrapper">
          <img class="grid-image" src="${imgUrl}" alt="${post.topic}" onerror="this.onerror=null; this.src='${fallbackUrl}';">
          <div class="grid-badge">KW ${dateInfo.kw} • W${post.scheduled_week}</div>
          <button class="grid-card-download-btn" title="Foto herunterladen" onclick="event.stopPropagation(); downloadPostImage('${post.post_id}')">📥</button>
        </div>
        <div class="grid-card-content">
          <div class="grid-card-title">${post.topic}</div>
          <div class="grid-card-location">📍 ${post.target_location || 'GAP'} • 🗓️ ${dateInfo.dateString}</div>
        </div>
      </div>
    `;
  }).join("");
}

// Render List / Timeline View
function renderList() {
  const listContainer = document.getElementById("listView");
  if (!listContainer) return;

  listContainer.innerHTML = contentData.map((post) => {
    const dateInfo = getPostScheduledDate(post.scheduled_week);
    const imgUrl = getPostImageUrl(post);
    const fallbackUrl = getFallbackImageUrl(post);
    return `
      <div class="list-card ${post.post_id === activePostId ? 'active' : ''}" onclick="selectPost('${post.post_id}')">
        <img class="list-thumb" src="${imgUrl}" alt="${post.topic}" onerror="this.onerror=null; this.src='${fallbackUrl}';">
        <div class="list-info">
          <h3>Woche ${post.scheduled_week} (KW ${dateInfo.kw} • ${dateInfo.dateString}): ${post.topic}</h3>
          <p class="list-hook">${post.caption.split('\n')[0]}</p>
        </div>
        <button class="btn btn-glass btn-icon-only" title="Foto herunterladen" onclick="event.stopPropagation(); downloadPostImage('${post.post_id}')">📥</button>
        <button class="btn btn-glass btn-icon-only" title="Bearbeiten" onclick="event.stopPropagation(); selectPost('${post.post_id}'); openEditModal();">✏️</button>
      </div>
    `;
  }).join("");
}

// Select a Post and Update Smartphone Preview
function selectPost(postId) {
  activePostId = postId;
  const post = contentData.find((p) => p.post_id === postId);
  if (!post) return;

  const dateInfo = getPostScheduledDate(post.scheduled_week);

  // Highlight active states
  renderGrid();
  renderList();

  // Update Smartphone Inspector
  document.getElementById("igLocation").innerText = post.target_location || "Garmisch-Partenkirchen";
  const igImg = document.getElementById("igMediaImage");
  const fallbackUrl = getFallbackImageUrl(post);
  igImg.onerror = () => {
    igImg.onerror = null;
    igImg.src = fallbackUrl;
  };
  igImg.src = getPostImageUrl(post);

  
  // Format Caption with clickable hashtags
  const captionHtml = escapeXml(post.caption)
    .replace(/(#[a-zA-Z0-9äöüÄÖÜß_]+)/g, '<span class="ig-hashtags">$1</span>')
    .replace(/\n/g, '<br>');

  document.getElementById("igCaptionText").innerHTML = `<strong>heizmobil</strong> ${captionHtml}`;
  document.getElementById("inspectorTitle").innerText = `Woche ${post.scheduled_week} • KW ${dateInfo.kw} (${dateInfo.dateString})`;

  const promptTextEl = document.getElementById("promptPreviewText");
  if (promptTextEl) {
    promptTextEl.innerText = post.image_prompt || "";
  }
}

// Alternative Variations Pool for Post Regeneration (Werdenfels & Rupp Grasegger Focus)
const postVariations = {
  1: [
    {
      topic: "Notfall-Heizung im Bergwinter",
      target_location: "Partenkirchen (Ludwigstraße)",
      caption: "Draußen -12 °C an der Zugspitze und drinnen wird’s eisig? 🥶🔥\n\nWenn im tiefsten Werdenfelser Winter plötzlich der Heizkessel streikt, zählt jede Minute. Kalte Heizkörper und drohende Frostschäden am Haus braucht kein Mensch! \n\nGenau für solche Momente stehen unsere mobilen Heizmobile startklar in Garmisch-Partenkirchen. Innerhalb kürzester Zeit koppeln wir unsere kompakte Heizzentrale an dein bestehendes System an.\n\n💬 Kaltes Haus? Ned bei uns! Ruf direkt unseren 24/7 Notdienst an!\n\n🔗 https://www.heizmobil.info/\n\n#GarmischPartenkirchen #Werdenfels #Zugspitzland #Heizmobil #HeizungNotdienst",
      image_prompt: "Photorealistic 8k photo of an official Rupp Grasegger 'Heizmobil' trailer (compact white and red PKW car trailer mobile heating unit with stainless steel chimney) parked outside a snow-covered Bavarian chalet in Partenkirchen. Zugspitze in background glow."
    },
    {
      topic: "Eiseskälte in Garmisch? Wir bringen Wärme!",
      target_location: "Garmisch (Mohrenplatz)",
      caption: "Plötzlicher Kesselausfall am Wochenende? Kein Grund zur Panik im Werdenfels! ❄️🔥\n\nEin Ausfall der Hauptheizung im kalten Alpenwinter ist der Albtraum jedes Hausbesitzers. Mit dem mobilen Heizmobil von Rupp Grasegger überbrücken wir jede Ausfallzeit lückenlos.\n\nEinfach anschließen, aufdrehen und das Haus bleibt kuschelig warm!\n\n📞 Unser 24/7 Notdienst hilft sofort in GAP und Umgebung: heizmobil.info\n\n#Garmisch #WerdenfelserLand #Notfallheizung #Schnellhilfe #Heizungssanierung"
    },
    {
      topic: "Wärme-Garantie für Partenkirchen",
      target_location: "Partenkirchen (Rathausplatz)",
      caption: "Wenn der Kessel kocht oder gar nichts mehr geht: Heizmobil ist da! 🏔️❤️\n\nWir lassen niemanden im Landkreis Garmisch-Partenkirchen im Kühlen sitzen. Unsere Heizzentralen auf Rädern sind in weniger als 2 Stunden betriebsbereit vor Ort.\n\n👉 Speichere dir unsere Notrufnummer direkt ab: heizmobil.info\n\n#Partenkirchen #Heizmobil #NotdienstGAP #AlpineWaerme #HandwerkRegion"
    }
  ],
  2: [
    {
      topic: "Alpine Baustellenheizung & Estrichtrocknung",
      target_location: "Grainau (Waxensteine)",
      caption: "Frost auf der Baustelle in Grainau? Lass deinen Zeitplan nicht einfrieren! 🏗️❄️\n\nFeuchtigkeit und eisige Temperaturen können den Estrich- und Innenausbau wochenlang stoppen. Mit unseren elektrischen Mini-Heizmobilen (36 kW) sorgen wir für normgerechte Aufheizprotokolle!\n\n👉 Baustelle absichern & Heizmobil mieten: heizmobil.info!\n\n#Grainau #Baustellenheizung #Estrichtrocknung #Bautrocknung #Werdenfels"
    },
    {
      topic: "Normgerechtes Trocknen am Bau",
      target_location: "Grainau (Zugspitzdorf)",
      caption: "Damit der Fliesenleger pünktlich anfangen kann! 📐🏗️\n\nPräzise Estrichtrocknung ist Ehrensache im alpinen Holz- & Massivbau. Unsere kompakten Rupp Grasegger Elektro-Mini-Heizmobile laufen leise und gradgenau auf deiner Baustelle in Grainau.\n\n📲 Jetzt Trocknungsgerät buchen auf heizmobil.info!\n\n#Grainau #Bauherr2026 #Estrichtrocknung #NeubauGAP #AlpineBaustelle"
    }
  ],
  3: [
    {
      topic: "Event-Wärme für alpine Feste",
      target_location: "Hausberg Garmisch",
      caption: "Feiern im Werdenfels ohne kalte Füße! 🥨🍻🔥\n\nOb Winterfest am Hausberg, uriges Event in der Berghütte oder großes Vereinsfest – unsere mobilen Event-Heizungen laufen leise, geruchsarm und zuverlässig im Hintergrund.\n\n📩 Schreib uns für ein unverbindliches Angebot oder besuche heizmobil.info.\n\n#Garmisch #Hausberg #Eventheizung #Zeltheizung #FeiernInDenBergen"
    },
    {
      topic: "Warmes Festzelt in den Bergen",
      target_location: "Garmisch-Partenkirchen",
      caption: "Warme Stimmung auf jedem Alpen-Event! 🎪🔥\n\nMit unseren leistungsstarken Mobilheizzentralen halten wir Festzelte und Freiluft-Locations auch bei Schnee konstant warm. Deine Gäste werden es lieben!\n\n📅 Planst du ein Event in GAP? Informiere dich auf heizmobil.info!\n\n#Eventheizung #Zeltheizung #WerdenfelsEvents #GarmischPartenkirchen"
    }
  ]
};

// Universal Fallback Generator for any week (strictly using official Rupp Grasegger products & Werdenfels locations)
function createDynamicVariation(post) {
  const week = post.scheduled_week;
  const locations = [
    "Partenkirchen (Ludwigstraße mit Zugspitzblick)",
    "Grainau (Zugspitzdorf an den Waxensteinen)",
    "Mittenwald (Historische Obermarkt-Gassen mit Karwendelblick)",
    "Garmisch (Mohrenplatz & Hausberg)",
    "Farchant (Traditionelles Werdenfelser Holzhaus)",
    "Eibsee (Smaragdgrüner See unter der Zugspitze)",
    "Wallgau (Isarwinkel im Werdenfelser Land)",
    "Riessersee (Alpenhotel GAP)"
  ];

  // Official Rupp Grasegger Product Lines from website
  const officialProductSpecs = [
    {
      category: "Heizmobil (PKW-Anhänger 30-350 kW)",
      promptSuffix: "An official Rupp Grasegger 'Heizmobil' trailer unit (a compact white and red PKW enclosed car trailer with 'HEIZMOBIL - Mobile Heizzentrale - Rupp Grasegger' logo printed on side, featuring a tall stainless steel exhaust chimney and heavy-duty flexible black insulated heating hoses connected to a building window)."
    },
    {
      category: "Mini-Heizmobil (Elektrisch 3-36 kW)",
      promptSuffix: "An official Rupp Grasegger 'Mini-Heizmobil 36 kW' (a compact red metal electric mobile heating unit box with digital control display, pressure gauge, and water hoses connected to a floor heating manifold inside a Bavarian house)."
    },
    {
      category: "Lüfterhitzer & Trocknungsgerät",
      promptSuffix: "An official Rupp Grasegger 'Lüfterhitzer' (a heavy-duty red industrial warm air heater unit with large blue insulated air ducting running into a building construction site)."
    },
    {
      category: "Allround & Pellet-Heizmobil",
      promptSuffix: "An official Rupp Grasegger eco-friendly 'Pellet-Heizmobil' (a compact forest-green mobile pellet boiler container unit)."
    }
  ];

  const newLoc = locations[(post.variation_index || 0) % locations.length];
  const prodSpec = officialProductSpecs[(week + (post.variation_index || 0)) % officialProductSpecs.length];
  const varId = (post.variation_index || 0) + 1;

  const topics = [
    `Mobile Wärme-Garantie: ${prodSpec.category}`,
    `Notdienst & Schnellhilfe in ${newLoc.split(' ')[0]}`,
    `Geprüfte Qualität: ${prodSpec.category}`,
    `Profi-Heiztechnik fürs Werdenfelser Land`
  ];
  const newTopic = topics[varId % topics.length];

  const captions = [
    `Vollkommen unabhängig & sofort betriebsbereit in ${newLoc.split(' ')[0]}! 🏔️🔥\n\nMit unseren offiziellen Einheiten – vom elektrischen Mini-Heizmobil (36 kW) für die Estrichtrocknung bis zum leistungsstarken Heizmobil-Anhänger (bis 350 kW) – sichern wir Hausbesitzer und Bauherren im Werdenfelser Land lückenlos ab.\n\n💬 Notfall oder geplante Sanierung? Wir liefern direkt an deinen Standort!\n\n🔗 heizmobil.info\n\n#GarmischPartenkirchen #Werdenfels #${newLoc.split(' ')[0]} #Heizmobil #RuppGrasegger #AlpineWaerme`,
    `Höchste Ausfallsicherheit für dein Gebäude in ${newLoc.split(' ')[0]}! ❄️🔥\n\nEgal ob Kesseltausch, Rohrbruch oder Baustellenbeheizung: Unsere mobilen Heizzentralen und Lüfterhitzer von Rupp Grasegger laufen leise, abgasgeprüft und hocheffizient.\n\n👉 Jetzt Angebot anfordern auf heizmobil.info!\n\n#WerdenfelserLand #Heizmobil #${newLoc.split(' ')[0]} #HandwerkRegion #AlpineWaerme`
  ];

  // Match seasonal atmosphere to scheduled week
  let seasonalScene = "Atmospheric alpine winter lighting, snow-covered landscape";
  if (week >= 12) {
    seasonalScene = "Bright alpine spring sunshine, fresh green meadow grass with snow-capped mountain peaks in the distance";
  } else if (week === 11) {
    seasonalScene = "Atmospheric alpine winter night scene, warm glowing streetlamps and freshly fallen snow";
  }

  const fullPrompt = `${prodSpec.promptSuffix} Operating at ${newLoc}. ${seasonalScene}, crisp photorealistic 8k photography, upright orientation, authentic local Bavarian environment, no stock photo look.`;

  return {
    topic: newTopic,
    target_location: newLoc,
    caption: captions[varId % captions.length],
    image_prompt: fullPrompt
  };
}

let isRegenerating = false;

// Regenerate a Single Post (Content & Visuals)
async function regeneratePost(postId) {
  if (isRegenerating) {
    showToast("⏳ Bitte kurz warten – ein KI-Foto wird bereits generiert...");
    return;
  }

  const postIndex = contentData.findIndex((p) => p.post_id === postId);
  if (postIndex === -1) return;

  isRegenerating = true;
  const regenBtn = document.getElementById("btnRegeneratePost");
  const originalBtnHtml = regenBtn ? regenBtn.innerHTML : "";
  if (regenBtn) {
    regenBtn.disabled = true;
    regenBtn.style.opacity = "0.7";
    regenBtn.innerHTML = `<span>⏳</span> Generiere KI-Foto...`;
  }

  try {
    // 1. Prepare candidate variation without wiping the currently displayed image yet
    const nextVariationIndex = (contentData[postIndex].variation_index || 0) + 1;
    const candidatePost = {
      ...contentData[postIndex],
      variation_index: nextVariationIndex,
      _ts: Date.now()
    };
    const nextVar = createDynamicVariation(candidatePost);
    candidatePost.topic = nextVar.topic;
    if (nextVar.target_location) candidatePost.target_location = nextVar.target_location;
    candidatePost.caption = nextVar.caption;
    if (nextVar.image_prompt) candidatePost.image_prompt = nextVar.image_prompt;

    // 2. Generate brand-new photorealistic AI photo
    showToast("📸 Generiere neues High-Res KI-Foto...");
    let finalImageUrl = await generateRealAiPhotoAsync(candidatePost);

    // 3. Only call /api/save-image if client-side Canvas fallback returned a base64 DataURL
    //    (/api/generate-image already saves to /images/ and returns a clean relative path)
    if (finalImageUrl && finalImageUrl.startsWith("data:image/")) {
      try {
        const res = await fetch('/api/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_data_url: finalImageUrl,
            scheduled_week: candidatePost.scheduled_week,
            variation_index: nextVariationIndex
          })
        });
        if (res.ok) {
          const saved = await res.json();
          if (saved.image_url) {
            finalImageUrl = saved.image_url;
          } else if (saved.filename) {
            finalImageUrl = 'images/' + saved.filename;
          }
          console.log('✅ Fallback image saved to disk:', saved.filename || saved.image_url);
        }
      } catch (err) {
        console.warn('⚠️ Could not save fallback image to disk:', err.message);
      }
    }

    // 4. Atomically update post state once the new image is ready
    contentData[postIndex].variation_index = nextVariationIndex;
    contentData[postIndex].is_regenerated = true;
    contentData[postIndex]._ts = candidatePost._ts;
    contentData[postIndex].topic = candidatePost.topic;
    contentData[postIndex].target_location = candidatePost.target_location;
    contentData[postIndex].caption = candidatePost.caption;
    contentData[postIndex].image_prompt = candidatePost.image_prompt;
    contentData[postIndex].image_url = finalImageUrl || getFallbackImageUrl(candidatePost);

    // 5. Save state safely to LocalStorage & refresh UI
    persistToLocalStorage();
    selectPost(postId);
    renderGrid();
    renderList();
    showToast(`✨ Neues Foto & Beitrag für "${nextVar.topic}" generiert! 📸`);
  } catch (err) {
    console.error("❌ Fehler beim Regenerieren:", err);
    showToast("⚠️ Generierung fehlgeschlagen – bitte erneut versuchen.");
  } finally {
    isRegenerating = false;
    if (regenBtn) {
      regenBtn.disabled = false;
      regenBtn.style.opacity = "1";
      regenBtn.innerHTML = originalBtnHtml;
    }
  }
}


// Open Edit Modal
function openEditModal() {
  const post = contentData.find((p) => p.post_id === activePostId);
  if (!post) return;

  document.getElementById("editTopic").value = post.topic;
  document.getElementById("editLocation").value = post.target_location || "";
  document.getElementById("editCaption").value = post.caption;
  document.getElementById("editPrompt").value = post.image_prompt;

  document.getElementById("modalBackdrop").classList.add("open");
}

function closeModal() {
  document.getElementById("modalBackdrop").classList.remove("open");
}

// Save Edits
function handleFormSave(e) {
  e.preventDefault();
  const postIndex = contentData.findIndex((p) => p.post_id === activePostId);
  if (postIndex === -1) return;

  contentData[postIndex].topic = document.getElementById("editTopic").value;
  contentData[postIndex].target_location = document.getElementById("editLocation").value;
  contentData[postIndex].caption = document.getElementById("editCaption").value;
  contentData[postIndex].image_prompt = document.getElementById("editPrompt").value;

  saveContentPlan();
  selectPost(activePostId);
  closeModal();
  showToast("Beitrag erfolgreich aktualisiert! ✨");
}

// Copy Functions
function copyCaption() {
  const post = contentData.find((p) => p.post_id === activePostId);
  if (post) {
    navigator.clipboard.writeText(post.caption);
    showToast("Caption in Zwischenablage kopiert! 📋");
  }
}

function togglePromptPreview() {
  const post = contentData.find((p) => p.post_id === activePostId);
  const box = document.getElementById("promptPreviewBox");
  const textEl = document.getElementById("promptPreviewText");
  const btn = document.getElementById("btnCopyPrompt");
  if (!box || !textEl || !post) return;

  const isHidden = box.style.display === "none";
  if (isHidden) {
    textEl.innerText = post.image_prompt || "(Kein Prompt vorhanden)";
    box.style.display = "block";
    if (btn) btn.innerHTML = "🎨 Prompt ausblenden";
  } else {
    box.style.display = "none";
    if (btn) btn.innerHTML = "🎨 Prompt anzeigen";
  }
}

function copyPrompt() {
  const post = contentData.find((p) => p.post_id === activePostId);
  if (post) {
    navigator.clipboard.writeText(post.image_prompt);
    showToast("Bild-Prompt in Zwischenablage kopiert! 🎨");
  }
}

// Export Functions
function exportJson() {
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(contentData, null, 2));
  const downloadAnchor = document.createElement("a");
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", "content_plan_heizmobil_q1.json");
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast("JSON Datei heruntergeladen! 🚀");
}

function exportCsv() {
  const headers = ["Scheduled Week", "Topic", "Location", "Caption", "Image Prompt"];
  const rows = contentData.map((p) => [
    p.scheduled_week,
    `"${p.topic.replace(/"/g, '""')}"`,
    `"${(p.target_location || '').replace(/"/g, '""')}"`,
    `"${p.caption.replace(/"/g, '""')}"`,
    `"${p.image_prompt.replace(/"/g, '""')}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", "content_plan_heizmobil_q1.csv");
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast("CSV Datei heruntergeladen! 📊");
}

// Simulate Webhook Trigger
function testWebhook() {
  const post = contentData.find((p) => p.post_id === activePostId);
  console.log("Simulating Webhook Payload send to Make/Zapier:", post);
  showToast(`Webhook Payload für Woche ${post.scheduled_week} simuliert! ⚡`);
}

// Publish Active Post directly to Instagram via Official Meta Graph API
let isPublishing = false;
async function publishToInstagram(postId) {
  if (isPublishing) return;
  const targetId = postId || activePostId;
  const post = contentData.find((p) => p.post_id === targetId);
  if (!post) return;

  const imageUrl = getPostImageUrl(post);
  if (!confirm(`Beitrag "${post.topic}" (Woche ${post.scheduled_week}) jetzt live auf Instagram posten?`)) {
    return;
  }

  isPublishing = true;
  const btn = document.getElementById("btnPublishInstagram");
  const originalHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btn.innerHTML = `<span>⏳</span> Veröffentliche auf Instagram...`;
  }

  try {
    const res = await fetch('/api/publish-instagram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        caption: post.caption,
        scheduled_week: post.scheduled_week
      })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.status === "success") {
      showToast(`🚀 Live auf Instagram gepostet! (Media ID: ${data.media_id})`);
    } else {
      alert(`Instagram Publish nicht möglich:\n\n${data.error || 'Unbekannter Fehler'}`);
      showToast(`⚠️ ${data.error || 'Instagram Publish fehlgeschlagen'}`);
    }
  } catch (err) {
    console.error("Instagram publish error:", err);
    showToast("❌ Server nicht erreichbar.");
  } finally {
    isPublishing = false;
    if (btn) {
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.innerHTML = originalHtml;
    }
  }
}

// Toast System
function showToast(message) {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<span>✅</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}
