import { Router, type IRouter } from "express";
import healthRouter from "./health";
import articlesRouter from "./articles";
import playbackRouter from "./playback";
import videosRouter from "./videos";
import { db, snippetsTable, articlesTable, videosTable, configStore } from "@workspace/db";
import { eq } from "drizzle-orm";

// In-memory TTS cache: snippetId → mp3 Buffer
const ttsCache = new Map<number, Buffer>();

// ── Waiting Screen Config (in-memory, admin pushes on load) ─────────────────
interface WaitingConfig {
  channelName: string;
  tagline: string;
  broadcastTime: string | null;
  nextBroadcastSource: string;
  topics: string[];
  websiteLabel: string;
  websiteUrl: string;
  socialLinks: Array<{ label: string; url: string }>;
  customTickerItems: string[];
  tickerSpeed: number;
  rotatingNames: Array<{ name: string; tagline: string }>;
  interludeImages: string[];
  ticker2Items: Array<{ text: string; url: string }>;
}

const WAITING_CONFIG_KEY = 'waiting_config';

let waitingConfig: WaitingConfig = {
  channelName: '',
  tagline: '',
  broadcastTime: null,
  nextBroadcastSource: '',
  topics: [],
  websiteLabel: '',
  websiteUrl: '',
  socialLinks: [],
  customTickerItems: [],
  tickerSpeed: 3,
  rotatingNames: [],
  interludeImages: [],
  ticker2Items: [],
};

// Load persisted config from DB on startup
(async () => {
  try {
    const rows = await db.select().from(configStore).where(eq(configStore.key, WAITING_CONFIG_KEY));
    if (rows.length > 0) {
      const parsed = JSON.parse(rows[0].value) as Partial<WaitingConfig>;
      waitingConfig = { ...waitingConfig, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load waiting config from DB:', e);
  }
})();

async function persistWaitingConfig() {
  try {
    await db.insert(configStore)
      .values({ key: WAITING_CONFIG_KEY, value: JSON.stringify(waitingConfig) })
      .onConflictDoUpdate({ target: configStore.key, set: { value: JSON.stringify(waitingConfig) } });
  } catch (e) {
    console.error('Failed to persist waiting config:', e);
  }
}

const router: IRouter = Router();

router.use(healthRouter);
router.use("/articles", articlesRouter);
router.use("/playback", playbackRouter);
router.use("/videos", videosRouter);

// PATCH /api/snippets/:id — edit snippet text fields
router.patch("/snippets/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ID" }); return; }
    const { headline, caption, explanation } = req.body ?? {};
    const updates: Record<string, string> = {};
    if (typeof headline === "string" && headline.trim()) updates.headline = headline.trim();
    if (typeof caption === "string" && caption.trim()) updates.caption = caption.trim();
    if (typeof explanation === "string" && explanation.trim()) updates.explanation = explanation.trim();
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }
    // Evict TTS cache so re-reading picks up new text
    ttsCache.delete(id);
    const rows = await db.update(snippetsTable).set(updates).where(eq(snippetsTable.id, id)).returning();
    if (rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /api/articles/:id — edit article title/source/archived
router.patch("/articles/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ID" }); return; }
    const { title, source, publishedAt, archived } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (typeof title === "string" && title.trim()) updates.title = title.trim();
    if (typeof source === "string") updates.source = source.trim();
    if (typeof publishedAt === "string") {
      const d = new Date(publishedAt);
      if (!isNaN(d.getTime())) updates.publishedAt = d;
    }
    if (typeof archived === "boolean") updates.archived = archived;
    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields to update" }); return; }
    const rows = await db.update(articlesTable).set(updates).where(eq(articlesTable.id, id)).returning();
    if (rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Proxy external images (for interlude images — bypasses hotlink protection / CORS)
router.get("/proxy-image", async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url || typeof url !== 'string') { res.status(400).end(); return; }
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsReaderBot/1.0)',
        'Accept': 'image/*,*/*',
      },
      redirect: 'follow',
    });
    if (!response.ok) { res.status(response.status).end(); return; }
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(buffer);
  } catch {
    res.status(502).end();
  }
});

// Serve snippet images at /api/snippets/:id/image
router.get("/snippets/:id/image", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const rows = await db.select({ imageUrl: snippetsTable.imageUrl }).from(snippetsTable).where(eq(snippetsTable.id, id));
    if (rows.length === 0 || !rows[0].imageUrl) {
      res.status(404).end();
      return;
    }
    const dataUrl = rows[0].imageUrl;
    const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      res.status(404).end();
      return;
    }
    const mimeType = base64Match[1];
    const buffer = Buffer.from(base64Match[2], "base64");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.send(buffer);
  } catch {
    res.status(500).end();
  }
});

// Serve snippet TTS audio at /api/snippets/:id/audio
router.get("/snippets/:id/audio", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    // Return cached audio if available
    if (ttsCache.has(id)) {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(ttsCache.get(id));
      return;
    }

    // Fetch snippet text from DB
    const rows = await db
      .select({ headline: snippetsTable.headline, caption: snippetsTable.caption, explanation: snippetsTable.explanation })
      .from(snippetsTable)
      .where(eq(snippetsTable.id, id));
    if (rows.length === 0) { res.status(404).end(); return; }

    const { headline, caption, explanation } = rows[0];
    const text = [headline, caption, explanation].filter(Boolean).join(". ");

    // Split text into ≤185-char chunks; sentence boundaries first, then word boundaries
    function chunkText(input: string, maxLen = 185): string[] {
      const chunks: string[] = [];

      // Split on sentence boundaries
      const sentences = input.match(/[^.!?]+[.!?]*/g) ?? [input];
      let current = '';

      for (const sentence of sentences) {
        const trimmed = sentence.trimStart();

        // If adding this sentence would exceed the limit, flush current buffer
        if (current && (current + trimmed).length > maxLen) {
          chunks.push(current.trim());
          current = '';
        }

        // If the sentence itself is too long, split on words
        if (trimmed.length > maxLen) {
          const words = trimmed.split(/\s+/);
          let wordChunk = '';
          for (const word of words) {
            if ((wordChunk + ' ' + word).trim().length > maxLen && wordChunk) {
              chunks.push(wordChunk.trim());
              wordChunk = word;
            } else {
              wordChunk = wordChunk ? wordChunk + ' ' + word : word;
            }
          }
          if (wordChunk.trim()) current = wordChunk + ' ';
        } else {
          current += trimmed;
        }
      }

      if (current.trim()) chunks.push(current.trim());
      return chunks.filter(c => c.length > 0);
    }

    const chunks = chunkText(text);
    const parts: Buffer[] = [];
    for (const chunk of chunks) {
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=en&client=tw-ob`;
      const ttsRes = await fetch(ttsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsReader/1.0)' }
      });
      if (!ttsRes.ok) throw new Error(`Google TTS returned ${ttsRes.status}`);
      parts.push(Buffer.from(await ttsRes.arrayBuffer()));
    }
    const buffer = Buffer.concat(parts);
    ttsCache.set(id, buffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (err) {
    console.error('[TTS] OpenAI audio error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/ticker — snippets from non-archived articles + custom waiting-screen items
router.get('/ticker', async (req, res) => {
  try {
    const rows = await db
      .select({ headline: snippetsTable.headline, caption: snippetsTable.caption })
      .from(snippetsTable)
      .innerJoin(articlesTable, eq(snippetsTable.articleId, articlesTable.id))
      .where(eq(articlesTable.archived, false));
    const snippetItems = rows.map(r => ({ headline: r.headline, caption: r.caption, isCustom: false }));
    const customItems = waitingConfig.customTickerItems.map(text => ({ headline: text, caption: '', isCustom: true }));
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.json([...snippetItems, ...customItems]);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sources — all unique source names from articles + videos
router.get('/sources', async (_req, res) => {
  try {
    const articles = await db.select({ source: articlesTable.source }).from(articlesTable);
    const videos = await db.select({ source: videosTable.source }).from(videosTable);
    const all = [...articles.map(r => r.source), ...videos.map(r => r.source)];
    const unique = [...new Set(all.filter((s): s is string => typeof s === 'string' && s.trim().length > 0))].sort();
    res.json(unique);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/waiting-config
router.get('/waiting-config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.json(waitingConfig);
});

// PUT /api/waiting-config
router.put('/waiting-config', async (req, res) => {
  const b = req.body ?? {};
  waitingConfig = {
    channelName: typeof b.channelName === 'string' ? b.channelName : waitingConfig.channelName,
    tagline: typeof b.tagline === 'string' ? b.tagline : waitingConfig.tagline,
    broadcastTime: 'broadcastTime' in b ? (b.broadcastTime || null) : waitingConfig.broadcastTime,
    nextBroadcastSource: typeof b.nextBroadcastSource === 'string' ? b.nextBroadcastSource : waitingConfig.nextBroadcastSource,
    topics: Array.isArray(b.topics) ? b.topics.filter((t: unknown) => typeof t === 'string') : waitingConfig.topics,
    websiteLabel: typeof b.websiteLabel === 'string' ? b.websiteLabel : waitingConfig.websiteLabel,
    websiteUrl: typeof b.websiteUrl === 'string' ? b.websiteUrl : waitingConfig.websiteUrl,
    socialLinks: Array.isArray(b.socialLinks) ? b.socialLinks : waitingConfig.socialLinks,
    customTickerItems: Array.isArray(b.customTickerItems)
      ? b.customTickerItems.filter((t: unknown) => typeof t === 'string')
      : waitingConfig.customTickerItems,
    tickerSpeed: typeof b.tickerSpeed === 'number' && b.tickerSpeed >= 1 && b.tickerSpeed <= 5
      ? b.tickerSpeed
      : waitingConfig.tickerSpeed,
    rotatingNames: Array.isArray(b.rotatingNames)
      ? b.rotatingNames.filter((t: unknown) => t !== null && typeof t === 'object' && 'name' in (t as object))
          .map((t: unknown) => ({ name: String((t as { name: string }).name), tagline: String((t as { tagline?: string }).tagline ?? '') }))
      : waitingConfig.rotatingNames,
    interludeImages: Array.isArray(b.interludeImages)
      ? b.interludeImages.filter((t: unknown) => typeof t === 'string')
      : waitingConfig.interludeImages,
    ticker2Items: Array.isArray(b.ticker2Items)
      ? b.ticker2Items.filter((t: unknown) => t !== null && typeof t === 'object' && 'text' in (t as object))
          .map((t: unknown) => ({ text: String((t as { text: string }).text), url: String((t as { url?: string }).url ?? '') }))
      : waitingConfig.ticker2Items,
  };
  await persistWaitingConfig();
  res.json(waitingConfig);
});

export default router;
