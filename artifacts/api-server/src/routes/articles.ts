import { Router, type IRouter } from "express";
import { db, articlesTable, snippetsTable } from "@workspace/db";
import { eq, asc, desc, sql, inArray } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

const URL_FETCH_TIMEOUT_MS = Number(process.env.TRAVEL_TV_URL_FETCH_TIMEOUT_MS || 5000);
const URL_FETCH_TOTAL_BUDGET_MS = Number(process.env.TRAVEL_TV_URL_FETCH_TOTAL_BUDGET_MS || 10000);
const PASTED_TEXT_META_TIMEOUT_MS = Number(process.env.TRAVEL_TV_PASTED_TEXT_META_TIMEOUT_MS || 2500);

function emptyPageData(): PageData {
  return {
    html: "",
    metaTitle: "",
    metaDescription: "",
    ogTitle: "",
    ogDescription: "",
    ogImage: "",
    publishedTime: "",
    author: "",
    jsonLd: "",
    bodyText: "",
  };
}

function snippetImageUrl(id: number): string {
  return `/api/snippets/${id}/image`;
}

function formatArticle(a: typeof articlesTable.$inferSelect, snippetCount: number) {
  return {
    id: a.id,
    url: a.url,
    title: a.title,
    summary: a.summary,
    source: a.source,
    publishedAt: a.publishedAt,
    createdAt: a.createdAt,
    snippetCount,
    archived: a.archived,
  };
}

function formatSnippet(s: typeof snippetsTable.$inferSelect) {
  return {
    id: s.id,
    articleId: s.articleId,
    snippetOrder: s.snippetOrder,
    headline: s.headline,
    caption: s.caption,
    explanation: s.explanation,
    imageUrl: s.imageUrl ? snippetImageUrl(s.id) : null,
    imagePrompt: s.imagePrompt,
    createdAt: s.createdAt,
  };
}

interface PageData {
  html: string;
  metaTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  publishedTime: string;
  author: string;
  jsonLd: string;
  bodyText: string;
}

async function fetchPageData(url: string): Promise<PageData> {
  const empty = emptyPageData();

  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
  ];

  let html = "";
  const startedAt = Date.now();
  for (const ua of userAgents) {
    if (Date.now() - startedAt >= URL_FETCH_TOTAL_BUDGET_MS) break;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": ua,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        html = await res.text();
        if (html.length > 500) break;
      }
    } catch {
      continue;
    }
  }

  if (!html) return empty;

  // Extract meta/og tags
  function getMeta(name: string): string {
    const patterns = [
      new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, "i"),
      new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${name}["']`, "i"),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1]) return m[1].trim();
    }
    return "";
  }

  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const metaTitle = titleMatch?.[1]?.trim() ?? "";

  // Extract JSON-LD structured data
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const jsonLd = jsonLdMatches.map(m => m[1]).join("\n").slice(0, ARTICLE_JSONLD_MAX_CHARS);

  // Extract body text — prefer article/main tags
  let bodyText = "";
  const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);

  const rawContent = articleMatch?.[1] || mainMatch?.[1] || bodyMatch?.[1] || html;
  bodyText = rawContent
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ARTICLE_BODY_MAX_CHARS);

  return {
    html,
    metaTitle,
    metaDescription: getMeta("description"),
    ogTitle: getMeta("og:title"),
    ogDescription: getMeta("og:description"),
    ogImage: getMeta("og:image"),
    publishedTime: getMeta("article:published_time") || getMeta("og:article:published_time") || getMeta("datePublished"),
    author: getMeta("author") || getMeta("article:author"),
    jsonLd,
    bodyText,
  };
}

interface SnippetData {
  headline: string;
  caption: string;
  explanation: string;
  imagePrompt: string;
}

interface ArticleData {
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  snippets: SnippetData[];
}

type GenerationMode = "ai" | "fallback";

interface GenerationMeta {
  mode: GenerationMode;
  message: string;
  reason?: string;
}

interface GeneratedArticleResult {
  content: ArticleData;
  generation: GenerationMeta;
}

function resolvePublishedDate(input: string | undefined): Date {
  if (!input) return new Date();
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  const parsed = Number(raw);
  if (!raw || Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

const COST_SAVER_MODE = process.env.TRAVEL_TV_ENABLE_COST_SAVER !== "false";
const ARTICLE_MODEL = COST_SAVER_MODE
  ? (process.env.TRAVEL_TV_COST_SAVER_MODEL || "gpt-4.1-mini")
  : (process.env.TRAVEL_TV_ARTICLE_MODEL || "gpt-4.1-mini");
const ARTICLE_MAX_COMPLETION_TOKENS = envInt("TRAVEL_TV_ARTICLE_MAX_TOKENS", 1600, 600, 3000);
const ARTICLE_TIMEOUT_MS = envInt("TRAVEL_TV_ARTICLE_TIMEOUT_MS", 12000, 5000, 120000);
const ARTICLE_BODY_MAX_CHARS = envInt("TRAVEL_TV_ARTICLE_BODY_MAX_CHARS", 4500, 1000, 12000);
const ARTICLE_JSONLD_MAX_CHARS = envInt("TRAVEL_TV_ARTICLE_JSONLD_MAX_CHARS", 1200, 200, 3000);
const IMAGE_GENERATION_LIMIT = envInt("TRAVEL_TV_IMAGE_GENERATION_LIMIT", 1, 0, 9);
const IMAGE_GENERATION_SIZE =
  process.env.TRAVEL_TV_IMAGE_SIZE === "256x256"
    ? "256x256"
    : process.env.TRAVEL_TV_IMAGE_SIZE === "1024x1024"
      ? "1024x1024"
      : "512x512";

function createPlaceholderImageDataUrl(text: string): string {
  const title = text.replace(/\s+/g, " ").trim().slice(0, 72) || "Felix Travel TV";
  const escaped = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="100%" stop-color="#1e293b"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><rect x="64" y="64" width="1072" height="672" rx="28" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.22)"/><text x="96" y="160" fill="#f8fafc" font-family="Arial, sans-serif" font-size="48" font-weight="700">Felix Travel TV</text><text x="96" y="230" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="34">${escaped}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function sentenceChunks(text: string, maxChunks = 6): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length === 0) return [cleaned.slice(0, 600)];

  const targetSize = Math.max(2, Math.ceil(sentences.length / Math.min(maxChunks, sentences.length)));
  const chunks: string[] = [];

  for (let index = 0; index < sentences.length; index += targetSize) {
    const chunk = sentences.slice(index, index + targetSize).join(" ").trim();
    if (chunk) chunks.push(chunk.slice(0, 700));
  }

  return chunks.slice(0, maxChunks);
}

function compactTitle(input: string, fallback: string): string {
  const title = input.replace(/\s+/g, " ").trim();
  if (!title) return fallback;
  return title.length <= 70 ? title : `${title.slice(0, 67).trim()}...`;
}

function buildFallbackArticleContent(url: string, page: PageData): ArticleData {
  const source = new URL(url).hostname.replace(/^www\./, "");
  const baseTitle = page.ogTitle || page.metaTitle || source;
  const bodyChunks = sentenceChunks(page.bodyText || page.ogDescription || page.metaDescription, 6);
  const chunks = bodyChunks.length > 0 ? bodyChunks : [
    `This story comes from ${source} and could not be fully extracted automatically, but the source article is still available for review.`,
    `Use the published source, timing, and location details from the original article to confirm the latest travel information before planning.`,
    `Felix Travel TV can still turn this topic into a usable briefing once the full article text is pasted into the admin panel.`,
  ];

  const snippets = chunks.slice(0, 6).map((chunk, index) => {
    const firstSentence = chunk.split(/(?<=[.!?])\s+/)[0]?.trim() || chunk;
    return {
      headline: compactTitle(index === 0 ? baseTitle : `Travel Brief ${index + 1}`, `Travel Brief ${index + 1}`),
      caption: compactTitle(firstSentence, "Travel update and planning insight."),
      explanation: chunk,
      imagePrompt: `Photorealistic travel editorial photography for ${baseTitle}, focused on ${firstSentence.toLowerCase()}, natural light, authentic destination details, high-end magazine composition`,
    };
  });

  while (snippets.length < 3) {
    const sequence = snippets.length + 1;
    snippets.push({
      headline: `Travel Brief ${sequence}`,
      caption: "Additional context from the source article.",
      explanation: `Felix Travel TV needs more source detail for this section. Paste the full article text to generate richer destination chapters and planning advice.`,
      imagePrompt: `Photorealistic travel newsroom visual for ${baseTitle}, editorial travel coverage, cinematic lighting, no text`,
    });
  }

  return {
    title: compactTitle(baseTitle, "Felix Travel TV Feature"),
    summary: compactTitle(page.ogDescription || page.metaDescription || chunks[0], "Travel story briefing from Felix Travel TV."),
    source,
    publishedAt: page.publishedTime || new Date().toISOString(),
    snippets,
  };
}

async function generateArticleContent(
  url: string,
  page: PageData,
  log?: { warn: (...args: any[]) => void; info?: (...args: any[]) => void },
): Promise<GeneratedArticleResult> {
  const hasRichContent = page.bodyText.length > 200 || page.ogDescription.length > 50 || page.jsonLd.length > 100;

  const context = [
    page.metaTitle && `Page title: ${page.metaTitle}`,
    page.ogTitle && `Article headline: ${page.ogTitle}`,
    page.ogDescription && `Description: ${page.ogDescription}`,
    page.author && `Author: ${page.author}`,
    page.publishedTime && `Published: ${page.publishedTime}`,
    page.jsonLd && `Structured data (JSON-LD):\n${page.jsonLd}`,
    page.bodyText && `Article body:\n${page.bodyText}`,
  ].filter(Boolean).join("\n\n");

  const prompt = `Create Felix Travel TV chapter content from this article.

URL: ${url}

SOURCE DATA:
${hasRichContent ? context : context || `URL clues: ${url}`}

REQUIREMENTS:
- Return valid JSON only.
- 6 or 7 snippets.
- Content must be specific and practical for travelers.
- Last snippet must be a Felix travel advisor call-to-action.
- Keep each explanation to 2 short sentences.
- Keep headlines <= 12 words.

JSON SCHEMA:
{
  "title": "string",
  "summary": "string",
  "source": "string",
  "publishedAt": "ISO 8601 string",
  "snippets": [
    {
      "headline": "string",
      "caption": "string",
      "explanation": "string",
      "imagePrompt": "string"
    }
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: ARTICLE_MODEL,
      max_completion_tokens: ARTICLE_MAX_COMPLETION_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }, {
      timeout: ARTICLE_TIMEOUT_MS,
    });

    log?.info?.(
      {
        url,
        model: ARTICLE_MODEL,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
      },
      "AI generation usage"
    );

    const content = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const snippets: SnippetData[] = Array.isArray(parsed.snippets)
      ? parsed.snippets.slice(0, 9).map((s: any) => ({
        headline: s.headline || "Travel Highlight",
        caption: s.caption || "A key moment from this story.",
        explanation: s.explanation || "More details are available about this travel story.",
        imagePrompt: s.imagePrompt || "Cinematic travel photography, golden hour lighting, beautiful destination, high quality",
      }))
      : [];

    if (snippets.length < 3) {
      throw new Error("Too few snippets generated");
    }

    return {
      content: {
        title: parsed.title || "Felix Travel TV Feature",
        summary: parsed.summary || "An important story is developing.",
        source: parsed.source || new URL(url).hostname.replace(/^www\./, ""),
        publishedAt: parsed.publishedAt || new Date().toISOString(),
        snippets,
      },
      generation: {
        mode: "ai",
        message: `AI generation completed with model ${ARTICLE_MODEL}.`,
      },
    };
  } catch (err: any) {
    const reason = err instanceof Error ? err.message : "Unknown AI generation error";
    log?.warn({ err, url, model: ARTICLE_MODEL }, "AI article generation failed, using fallback content");
    return {
      content: buildFallbackArticleContent(url, page),
      generation: {
        mode: "fallback",
        message: "Fallback content was used because AI generation failed. Paste full article text for richer chapters.",
        reason,
      },
    };
  }
}

async function generateImage(prompt: string): Promise<string | null> {
  try {
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: `High quality, photorealistic travel photography. No text, no logos, no watermarks. ${prompt}`,
      size: IMAGE_GENERATION_SIZE,
    });
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) return createPlaceholderImageDataUrl(prompt);
    return `data:image/png;base64,${b64}`;
  } catch (err: any) {
    return createPlaceholderImageDataUrl(prompt);
  }
}

/**
 * Generate and persist images for a list of snippets.
 *
 * Strategy:
 *   1. Fire all requests in parallel (fast — same as original approach).
 *   2. Collect any that came back null and retry them one-by-one with a
 *      short pause, so transient rate-limit blips don't leave blank chapters.
 *
 * This runs entirely after the HTTP response has been sent, so it never
 * contributes to request timeouts.
 */
async function generateAndSaveImages(
  snippets: Array<{ id: number; imagePrompt: string | null }>,
  log: { info: (...a: any[]) => void; error: (...a: any[]) => void }
) {
  const targetSnippets = snippets.slice(0, IMAGE_GENERATION_LIMIT);
  if (targetSnippets.length === 0) {
    log.info({ total: snippets.length }, "Image generation skipped by config");
    return;
  }

  // ── Pass 1: parallel ──────────────────────────────────────────────────────
  const results = await Promise.allSettled(
    targetSnippets.map(async (snippet) => {
      if (!snippet.imagePrompt) return { id: snippet.id, ok: false };
      const imageUrl = await generateImage(snippet.imagePrompt);
      if (imageUrl) {
        await db.update(snippetsTable).set({ imageUrl }).where(eq(snippetsTable.id, snippet.id));
        return { id: snippet.id, ok: true };
      }
      return { id: snippet.id, ok: false };
    })
  );

  const failed = targetSnippets.filter((_, i) => {
    const r = results[i];
    return r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok);
  });

  if (failed.length === 0) {
    log.info({ total: snippets.length, generated: targetSnippets.length }, "Image generation complete (all parallel)");
    return;
  }

  log.info({ failed: failed.length }, "Retrying failed images sequentially");

  // ── Pass 2: sequential retry for failures ─────────────────────────────────
  let retried = 0;
  for (const snippet of failed) {
    if (!snippet.imagePrompt) continue;
    await new Promise(r => setTimeout(r, 1200));
    const imageUrl = await generateImage(snippet.imagePrompt);
    if (imageUrl) {
      await db.update(snippetsTable).set({ imageUrl }).where(eq(snippetsTable.id, snippet.id));
      retried++;
    }
  }

  log.info({ total: snippets.length, generated: targetSnippets.length, retried }, "Image generation complete (with retries)");
}

// GET /api/articles
router.get("/", async (req, res) => {
  try {
    const articles = await db
      .select()
      .from(articlesTable)
      .orderBy(desc(articlesTable.createdAt));

    const articleIds = articles.map(a => a.id);
    let snippetCounts: Record<number, number> = {};

    if (articleIds.length > 0) {
      const counts = await db
        .select({
          articleId: snippetsTable.articleId,
          count: sql<number>`count(*)::int`,
        })
        .from(snippetsTable)
        .where(inArray(snippetsTable.articleId, articleIds))
        .groupBy(snippetsTable.articleId);

      counts.forEach(c => { snippetCounts[c.articleId] = c.count; });
    }

    res.json(articles.map(a => formatArticle(a, snippetCounts[a.id] ?? 0)));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch articles");
    res.status(500).json({ error: "Failed to fetch articles" });
  }
});

// POST /api/articles
router.post("/", async (req, res) => {
  try {
    const { url, text, source: sourceOverride, title: titleOverride, publishedDate } = req.body;

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "URL is required" });
      return;
    }

    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL format" });
      return;
    }

    let page: PageData;
    const hasUserText = text && typeof text === "string" && text.trim().length > 20;

    if (hasUserText) {
      // User pasted article text — fetch URL metadata in parallel for og/date
      // enrichment, but always use the pasted text as the body.
      let metaPage: PageData | null = null;
      try {
        metaPage = await Promise.race([
          fetchPageData(url),
          new Promise<PageData>((resolve) => {
            setTimeout(() => resolve(emptyPageData()), PASTED_TEXT_META_TIMEOUT_MS);
          }),
        ]);
      } catch {
        // Metadata fetch failure is non-fatal when text is provided
      }
      page = {
        html: metaPage?.html ?? "",
        metaTitle: titleOverride || metaPage?.metaTitle || "",
        metaDescription: metaPage?.metaDescription || "",
        ogTitle: titleOverride || metaPage?.ogTitle || "",
        ogDescription: metaPage?.ogDescription || "",
        ogImage: metaPage?.ogImage || "",
        publishedTime: metaPage?.publishedTime || "",
        author: metaPage?.author || "",
        jsonLd: metaPage?.jsonLd || "",
        bodyText: text.trim().slice(0, ARTICLE_BODY_MAX_CHARS),
      };
      req.log.info({ url, textLen: text.trim().length, hasMeta: !!metaPage?.ogTitle }, "Using pasted text with URL metadata");
    } else {
      // No text provided — try to fetch the URL
      page = await fetchPageData(url);
      req.log.info({ url, bodyLen: page.bodyText.length, hasOg: !!page.ogTitle }, "Fetched page data");

      // Content quality check: if we couldn't extract enough text from the URL,
      // the site might be SPA-rendered or behind a paywall. Reject and ask user to paste.
      const extractedText = page.bodyText || page.ogDescription || page.metaDescription || "";
      if (extractedText.trim().length < 200) {
        req.log.warn(
          { url, extractedLen: extractedText.length, hasBodyText: !!page.bodyText, hasOg: !!page.ogDescription },
          "URL did not contain enough extractable content; requesting user to paste article text"
        );
        res.status(400).json({
          error: "URL content could not be extracted",
          detail: `This article page (${new URL(url).hostname}) appears to be a single-page app or requires client-side rendering. Please open the article in your browser, copy the full text (Ctrl+A, Ctrl+C), and paste it in the text field below, then resubmit.`,
        });
        return;
      }
    }

    const generated = await generateArticleContent(url, page, req.log);
    const { content, generation } = generated;
    if (sourceOverride && typeof sourceOverride === "string") {
      content.source = sourceOverride;
    }

    // Use user-supplied date if provided, otherwise trust AI-detected date
    let resolvedDate: Date;
    if (publishedDate && typeof publishedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(publishedDate)) {
      resolvedDate = new Date(publishedDate + "T12:00:00Z");
    } else {
      resolvedDate = resolvePublishedDate(content.publishedAt);
      if (!content.publishedAt || Number.isNaN(new Date(content.publishedAt).getTime())) {
        req.log.warn({ publishedAt: content.publishedAt, url }, "Invalid generated publishedAt, defaulting to now");
      }
    }

    const [article] = await db.insert(articlesTable).values({
      url,
      title: content.title,
      summary: content.summary,
      source: content.source,
      publishedAt: resolvedDate,
      bodyText: page.bodyText || null,
    }).returning();

    // Insert snippets immediately with imageUrl = null so the article is
    // available right away. Images are generated in the background after the
    // response is sent, so the HTTP request never times out.
    const snippetRows = content.snippets.map((s, index) => ({
      articleId: article.id,
      snippetOrder: index,
      headline: s.headline,
      caption: s.caption,
      explanation: s.explanation,
      imageUrl: createPlaceholderImageDataUrl(s.headline || s.caption || s.imagePrompt || content.title),
      imagePrompt: s.imagePrompt,
    }));

    const insertedSnippets = await db
      .insert(snippetsTable)
      .values(snippetRows)
      .returning();

    // Respond immediately — the article is saved, chapters are ready.
    req.log.info({ articleId: article.id, generationMode: generation.mode, reason: generation.reason }, "Article created");

    res.status(201).json({
      ...formatArticle(article, insertedSnippets.length),
      generation: {
        mode: generation.mode,
        message: generation.message,
      },
    });

    // Fire-and-forget: generate images in the background (parallel-first, then
    // sequential retry for any that failed). Never blocks the HTTP response.
    generateAndSaveImages(insertedSnippets, req.log).catch(err =>
      req.log.error({ err, articleId: article.id }, "Background image generation failed")
    );
  } catch (err) {
    req.log.error({ err }, "Failed to create article");
    const detail = err instanceof Error ? err.message : "Unknown article processing error";
    res.status(422).json({ error: "Failed to process URL", detail });
  }
});

// POST /api/articles/:id/regenerate-chapters
// Re-runs the full AI chapter generation for an existing article using the
// latest prompt. Deletes all existing snippets and replaces them with fresh
// ones. Responds immediately; image generation runs in the background.
router.post("/:id/regenerate-chapters", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const articles = await db.select().from(articlesTable).where(eq(articlesTable.id, id));
    if (articles.length === 0) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    const article = articles[0];

    // Use the stored body text if available (preserves pasted content).
    // Only re-fetch from the URL if nothing was saved at creation time.
    let page: PageData;
    if (article.bodyText && article.bodyText.trim().length > 100) {
      page = {
        html: "",
        metaTitle: article.title,
        metaDescription: article.summary,
        ogTitle: article.title,
        ogDescription: article.summary,
        ogImage: "",
        publishedTime: "",
        author: "",
        jsonLd: "",
        bodyText: article.bodyText,
      };
      req.log.info({ articleId: id, bodyLen: article.bodyText.length }, "Regenerating chapters from stored body text");
    } else {
      page = await fetchPageData(article.url);
      req.log.info({ articleId: id, url: article.url, bodyLen: page.bodyText.length }, "Regenerating chapters by re-fetching URL");
    }

    const content = await generateArticleContent(article.url, page);

    // Keep the user-supplied source if they set one, otherwise use the AI source
    const resolvedSource = article.source ?? content.source;

    // Replace snippets atomically: delete old → insert new
    await db.delete(snippetsTable).where(eq(snippetsTable.articleId, id));

    const snippetRows = content.snippets.map((s, index) => ({
      articleId: id,
      snippetOrder: index,
      headline: s.headline,
      caption: s.caption,
      explanation: s.explanation,
      imageUrl: createPlaceholderImageDataUrl(s.headline || s.caption || s.imagePrompt || content.title),
      imagePrompt: s.imagePrompt,
    }));

    const insertedSnippets = await db.insert(snippetsTable).values(snippetRows).returning();

    // Update title/summary from the new generation
    await db.update(articlesTable)
      .set({ title: content.title, summary: content.summary, source: resolvedSource })
      .where(eq(articlesTable.id, id));

    // Respond right away — chapters are ready, images generate in background
    res.json({ id, chapters: insertedSnippets.length, title: content.title });

    generateAndSaveImages(insertedSnippets, req.log).catch(err =>
      req.log.error({ err, articleId: id }, "Background image generation failed after chapter regen")
    );
  } catch (err) {
    req.log.error({ err }, "Failed to regenerate chapters");
    res.status(500).json({ error: "Failed to regenerate chapters" });
  }
});

// POST /api/articles/:id/regenerate-images
// Queues image generation for all snippets that are missing an image.
// Responds immediately; generation runs in the background.
router.post("/:id/regenerate-images", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const articles = await db.select().from(articlesTable).where(eq(articlesTable.id, id));
    if (articles.length === 0) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    const snippets = await db
      .select()
      .from(snippetsTable)
      .where(eq(snippetsTable.articleId, id))
      .orderBy(asc(snippetsTable.snippetOrder));

    const missing = snippets.filter(s => !s.imageUrl && s.imagePrompt);

    // Respond immediately so the request never times out.
    res.json({ total: snippets.length, missing: missing.length, started: true });

    // Generate in the background using the same parallel-first strategy.
    if (missing.length > 0) {
      generateAndSaveImages(missing, req.log).catch(err =>
        req.log.error({ err, articleId: id }, "Regenerate images failed")
      );
    }
  } catch (err) {
    req.log.error({ err }, "Failed to start image regeneration");
    res.status(500).json({ error: "Failed to regenerate images" });
  }
});

// DELETE /api/articles/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const result = await db.delete(articlesTable).where(eq(articlesTable.id, id)).returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete article");
    res.status(500).json({ error: "Failed to delete article" });
  }
});

// GET /api/articles/:id/snippets
// Note: Cache-Control: no-store prevents stale 304 responses from hiding
// image-URL updates that arrive after background generation completes.
router.get("/:id/snippets", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    const articles = await db.select().from(articlesTable).where(eq(articlesTable.id, id));
    if (articles.length === 0) {
      res.status(404).json({ error: "Article not found" });
      return;
    }

    // Select only the columns we need — deliberately exclude image_url
    // (which is a 2-3 MB base64 string) to keep responses fast and small.
    // We only need to know whether an image exists, not the raw data.
    const snippets = await db
      .select({
        id: snippetsTable.id,
        articleId: snippetsTable.articleId,
        snippetOrder: snippetsTable.snippetOrder,
        headline: snippetsTable.headline,
        caption: snippetsTable.caption,
        explanation: snippetsTable.explanation,
        hasImage: sql<boolean>`(${snippetsTable.imageUrl} IS NOT NULL)`,
        imagePrompt: snippetsTable.imagePrompt,
        createdAt: snippetsTable.createdAt,
      })
      .from(snippetsTable)
      .where(eq(snippetsTable.articleId, id))
      .orderBy(asc(snippetsTable.snippetOrder));

    res.setHeader("Cache-Control", "no-store");
    res.json(snippets.map(s => ({
      id: s.id,
      articleId: s.articleId,
      snippetOrder: s.snippetOrder,
      headline: s.headline,
      caption: s.caption,
      explanation: s.explanation,
      imageUrl: s.hasImage ? snippetImageUrl(s.id) : null,
      imagePrompt: s.imagePrompt,
      createdAt: s.createdAt,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch snippets");
    res.status(500).json({ error: "Failed to fetch snippets" });
  }
});

export default router;
