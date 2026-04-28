import { Router, type IRouter } from "express";
import { db, articlesTable, snippetsTable } from "@workspace/db";
import { eq, asc, desc, sql, inArray } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { extractPageContent } from "../lib/articleExtraction";

const router: IRouter = Router();

const URL_FETCH_TIMEOUT_MS = Number(process.env.TRAVEL_TV_URL_FETCH_TIMEOUT_MS || 5000);
const URL_FETCH_TOTAL_BUDGET_MS = Number(process.env.TRAVEL_TV_URL_FETCH_TOTAL_BUDGET_MS || 10000);
const PASTED_TEXT_META_TIMEOUT_MS = Number(process.env.TRAVEL_TV_PASTED_TEXT_META_TIMEOUT_MS || 2500);
const PAGE_FETCH_HARD_TIMEOUT_MS = Number(process.env.TRAVEL_TV_PAGE_FETCH_HARD_TIMEOUT_MS || 8000);
const CHAPTER_GENERATION_HARD_TIMEOUT_MS = Number(process.env.TRAVEL_TV_CHAPTER_GENERATION_HARD_TIMEOUT_MS || 14000);

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

function snippetImageUrlWithVersion(id: number, version: string): string {
  return `${snippetImageUrl(id)}?v=${encodeURIComponent(version)}`;
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
      const nextHtml = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("html")) continue;
      if (nextHtml.length > html.length) {
        html = nextHtml;
      }
      if (res.ok && nextHtml.length > 500) break;
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
  const extracted = extractPageContent(html, jsonLd);

  return {
    html,
    metaTitle,
    metaDescription: getMeta("description"),
    ogTitle: getMeta("og:title"),
    ogDescription: getMeta("og:description"),
    ogImage: getMeta("og:image"),
    publishedTime: getMeta("article:published_time") || getMeta("og:article:published_time") || getMeta("datePublished") || extracted.publishedTime,
    author: getMeta("author") || getMeta("article:author") || extracted.author,
    jsonLd,
    bodyText: extracted.bodyText.slice(0, ARTICLE_BODY_MAX_CHARS),
  };
}

async function fetchPageDataWithHardTimeout(url: string): Promise<PageData> {
  return await Promise.race([
    fetchPageData(url),
    new Promise<PageData>((resolve) => {
      setTimeout(() => resolve(emptyPageData()), PAGE_FETCH_HARD_TIMEOUT_MS);
    }),
  ]);
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

function parseJsonFromModelOutput(raw: string): any {
  const text = (raw || "").trim();
  if (!text) return {};

  // 1) Strict JSON
  try {
    return JSON.parse(text);
  } catch {
    // continue
  }

  // 2) Markdown fenced JSON
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // continue
    }
  }

  // 3) First balanced JSON object in mixed text
  const firstBrace = text.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    for (let i = firstBrace; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(firstBrace, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error("Model response did not contain parseable JSON");
}

function isLikelyErrorDocument(page: PageData): { isError: boolean; reason: string } {
  const combined = [
    page.metaTitle,
    page.ogTitle,
    page.metaDescription,
    page.ogDescription,
    page.bodyText.slice(0, 1600),
  ]
    .join(" ")
    .toLowerCase();

  const errorPatterns: Array<[RegExp, string]> = [
    [/\berror\s*404\b/, "404 page"],
    [/\bpage not found\b/, "page not found"],
    [/\bcan't find the page\b|\bcannot find the page\b/, "missing page"],
    [/\brequested page could not be found\b/, "missing page"],
    [/\bthis page is no longer here\b/, "missing page"],
  ];

  for (const [pattern, reason] of errorPatterns) {
    if (pattern.test(combined)) {
      return { isError: true, reason };
    }
  }

  return { isError: false, reason: "" };
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
const IMAGE_GENERATION_LIMIT = envInt("TRAVEL_TV_IMAGE_GENERATION_LIMIT", 9, 0, 9);
const IMAGE_GENERATION_RETRIES = envInt("TRAVEL_TV_IMAGE_RETRIES", 3, 1, 6);
const IMAGE_RETRY_BASE_DELAY_MS = envInt("TRAVEL_TV_IMAGE_RETRY_DELAY_MS", 1200, 300, 5000);
const IMAGE_MODELS = (process.env.TRAVEL_TV_IMAGE_MODELS || "gpt-image-1,dall-e-3,dall-e-2")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const IMAGE_PROVIDER = (process.env.TRAVEL_TV_IMAGE_PROVIDER || "ai").toLowerCase();
const IMAGE_GENERATION_SIZE =
  process.env.TRAVEL_TV_IMAGE_SIZE === "256x256"
    ? "256x256"
    : process.env.TRAVEL_TV_IMAGE_SIZE === "1024x1024"
      ? "1024x1024"
      : "512x512";

function imageSizeForModel(model: string): "256x256" | "512x512" | "1024x1024" | "1792x1024" | "1024x1792" {
  if (model === "dall-e-3") {
    return "1024x1024";
  }
  return IMAGE_GENERATION_SIZE;
}

function createPlaceholderImageDataUrl(text: string): string {
  const title = text.replace(/\s+/g, " ").trim().slice(0, 120) || "Travel scene";
  const escaped = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0b1220"/><stop offset="100%" stop-color="#1d3557"/></linearGradient><radialGradient id="r" cx="22%" cy="18%" r="72%"><stop offset="0%" stop-color="rgba(255,255,255,0.2)"/><stop offset="100%" stop-color="rgba(255,255,255,0)"/></radialGradient></defs><rect width="1200" height="800" fill="url(#g)"/><rect width="1200" height="800" fill="url(#r)"/><rect x="64" y="64" width="1072" height="672" rx="28" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.14)"/><text x="96" y="710" fill="rgba(226,232,240,0.9)" font-family="Arial, sans-serif" font-size="32">${escaped}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function isPlaceholderStoredImage(imageUrl: string | null | undefined): boolean {
  if (!imageUrl) return false;
  return imageUrl.startsWith("data:image/svg+xml");
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const KEYWORD_STOPWORDS = new Set([
  "about", "after", "along", "around", "because", "between", "close", "could", "every", "from",
  "great", "guide", "high", "into", "just", "like", "near", "open", "over", "photo", "scene",
  "show", "some", "that", "their", "there", "these", "this", "travel", "trip", "using", "with",
  "without", "your", "city", "view", "views", "feature", "chapter", "story", "local", "best",
]);

function extractImageKeywords(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => word.length >= 4)
    .filter((word) => !KEYWORD_STOPWORDS.has(word))
    .slice(0, 6);
}

function buildStockImageUrl(seedSource: string, promptText: string): string {
  const keywords = extractImageKeywords(promptText);
  const terms = keywords.length > 0 ? keywords.join(",") : "nature,landscape,travel";
  const seed = stringSeed(`${seedSource}:${terms}`);
  return `https://loremflickr.com/1600/900/${encodeURIComponent(terms)}?lock=${seed}`;
}

function buildStockImageCandidates(seedSource: string, promptText: string): string[] {
  const keywords = extractImageKeywords(promptText);
  const terms = keywords.length > 0 ? keywords.join(",") : "nature,landscape,travel";
  const seed = stringSeed(`${seedSource}:${terms}`);
  return [
    `https://loremflickr.com/1600/900/${encodeURIComponent(terms)}?lock=${seed}`,
    `https://picsum.photos/seed/felix-${seed}/1600/900`,
  ];
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FelixTravelTV/1.0)",
        "Accept": "image/*,*/*",
      },
      redirect: "follow",
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function resolveStockImageDataUrl(seedSource: string, promptText: string): Promise<string | null> {
  const candidates = buildStockImageCandidates(seedSource, promptText);
  for (const candidate of candidates) {
    const dataUrl = await fetchImageAsDataUrl(candidate);
    if (dataUrl) return dataUrl;
  }
  return null;
}

async function initialClipImageUrl(
  seedSource: string,
  promptText: string,
  placeholderText: string,
): Promise<string> {
  if (IMAGE_PROVIDER === "stock") {
    const resolved = await resolveStockImageDataUrl(seedSource, promptText);
    if (resolved) return resolved;
  }
  return createPlaceholderImageDataUrl(placeholderText);
}

function stringSeed(input: string): number {
  let value = 0;
  for (let index = 0; index < input.length; index++) {
    value = (value * 31 + input.charCodeAt(index)) >>> 0;
  }
  return value;
}

function shortChapterLabel(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "Felix Travel TV";
  return cleaned.length <= 56 ? cleaned : `${cleaned.slice(0, 53).trim()}...`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createChapterVariantImageDataUrl(baseImageUrl: string, chapterText: string, seedSource: string): string {
  const seed = stringSeed(seedSource);
  const hueA = seed % 360;
  const hueB = (seed * 7) % 360;
  const offsetX = -120 - (seed % 180);
  const offsetY = -60 - (seed % 120);
  const scale = 1.12 + ((seed % 9) * 0.02);
  const label = escapeXml(shortChapterLabel(chapterText));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><clipPath id="card"><rect x="56" y="56" width="1088" height="688" rx="30" ry="30"/></clipPath><linearGradient id="wash" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsla(${hueA},70%,50%,0.22)"/><stop offset="100%" stop-color="hsla(${hueB},70%,50%,0.14)"/></linearGradient><linearGradient id="fade" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stop-color="rgba(2,6,23,0.88)"/><stop offset="55%" stop-color="rgba(2,6,23,0.28)"/><stop offset="100%" stop-color="rgba(2,6,23,0.12)"/></linearGradient></defs><rect width="1200" height="800" fill="#020617"/><g clip-path="url(#card)"><image href="${baseImageUrl}" x="${offsetX}" y="${offsetY}" width="${Math.round(1200 * scale)}" height="${Math.round(800 * scale)}" preserveAspectRatio="xMidYMid slice"/><rect x="56" y="56" width="1088" height="688" fill="url(#wash)"/><rect x="56" y="56" width="1088" height="688" fill="url(#fade)"/></g><rect x="56" y="56" width="1088" height="688" rx="30" ry="30" fill="none" stroke="rgba(255,255,255,0.18)"/><text x="96" y="118" fill="rgba(255,255,255,0.72)" font-family="Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="2">FELIX TRAVEL TV</text><foreignObject x="92" y="580" width="1016" height="120"><div xmlns="http://www.w3.org/1999/xhtml" style="color:#f8fafc;font-family:Arial,sans-serif;font-size:42px;font-weight:700;line-height:1.12;">${label}</div></foreignObject></svg>`;
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

  const snippets = chunks.slice(0, 7).map((chunk, index) => {
    const firstSentence = chunk.split(/(?<=[.!?])\s+/)[0]?.trim() || chunk;
    return {
      headline: compactTitle(index === 0 ? baseTitle : `Travel Brief ${index + 1}`, `Travel Brief ${index + 1}`),
      caption: compactTitle(firstSentence, "Travel update and planning insight."),
      explanation: chunk,
      imagePrompt: `Photorealistic travel editorial photography for ${baseTitle}, focused on ${firstSentence.toLowerCase()}, natural light, authentic destination details, high-end magazine composition`,
    };
  });

  while (snippets.length < 4) {
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
    const parsed = parseJsonFromModelOutput(content);
    const snippets: SnippetData[] = Array.isArray(parsed.snippets)
      ? parsed.snippets.slice(0, 9).map((s: any) => ({
        headline: s.headline || "Travel Highlight",
        caption: s.caption || "A key moment from this story.",
        explanation: s.explanation || "More details are available about this travel story.",
        imagePrompt: s.imagePrompt || "Cinematic travel photography, golden hour lighting, beautiful destination, high quality",
      }))
      : [];

    if (snippets.length < 4) {
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

async function generateArticleContentWithHardTimeout(
  url: string,
  page: PageData,
  log?: { warn: (...args: any[]) => void; info?: (...args: any[]) => void },
): Promise<GeneratedArticleResult> {
  const timeoutFallback: GeneratedArticleResult = {
    content: buildFallbackArticleContent(url, page),
    generation: {
      mode: "fallback",
      message: "Fallback content was used because generation timed out.",
      reason: `generation hard-timeout after ${CHAPTER_GENERATION_HARD_TIMEOUT_MS}ms`,
    },
  };

  const result = await Promise.race([
    generateArticleContent(url, page, log),
    new Promise<GeneratedArticleResult>((resolve) => {
      setTimeout(() => resolve(timeoutFallback), CHAPTER_GENERATION_HARD_TIMEOUT_MS);
    }),
  ]);

  if (result.generation.mode === "fallback" && result.generation.reason?.includes("hard-timeout")) {
    log?.warn?.(
      { url, timeoutMs: CHAPTER_GENERATION_HARD_TIMEOUT_MS },
      "Article generation hit hard-timeout; returned fallback to avoid request timeout"
    );
  }

  return result;
}

async function generateAiImage(prompt: string): Promise<string | null> {
  const finalPrompt = `High quality, photorealistic travel photography. No text, no logos, no watermarks. ${prompt}`;

  for (const model of IMAGE_MODELS) {
    try {
      const response = await openai.images.generate({
        model,
        prompt: finalPrompt,
        size: imageSizeForModel(model),
      });

      const first = response.data?.[0];
      const b64 = first?.b64_json;
      if (b64) {
        return `data:image/png;base64,${b64}`;
      }

      const url = first?.url;
      if (url && /^https?:\/\//i.test(url)) {
        return url;
      }
    } catch {
      // Try the next configured model.
      continue;
    }
  }

  return null;
}

async function generateAiImageWithRetries(prompt: string): Promise<string | null> {
  for (let attempt = 1; attempt <= IMAGE_GENERATION_RETRIES; attempt++) {
    const imageUrl = await generateAiImage(prompt);
    if (imageUrl) return imageUrl;

    if (attempt < IMAGE_GENERATION_RETRIES) {
      await sleep(IMAGE_RETRY_BASE_DELAY_MS * attempt);
    }
  }

  return null;
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
  snippets: Array<{ id: number; imagePrompt: string | null; headline?: string | null; caption?: string | null; explanation?: string | null }>,
  log: { info: (...a: any[]) => void; error: (...a: any[]) => void }
) {
  const targetSnippets = snippets.slice(0, IMAGE_GENERATION_LIMIT);
  if (targetSnippets.length === 0) {
    log.info({ total: snippets.length }, "Image generation skipped by config");
    return;
  }

  let generated = 0;
  const failed: Array<{ id: number; imagePrompt: string | null }> = [];

  if (IMAGE_PROVIDER === "stock") {
    for (const snippet of targetSnippets) {
      const promptText = snippet.imagePrompt || snippet.headline || snippet.caption || snippet.explanation || "travel destination";
      const imageUrl = await resolveStockImageDataUrl(`${snippet.id}`, promptText)
        || createPlaceholderImageDataUrl(promptText);
      await db.update(snippetsTable).set({ imageUrl }).where(eq(snippetsTable.id, snippet.id));
      generated++;
    }

    log.info(
      { total: snippets.length, generated, provider: IMAGE_PROVIDER },
      "Assigned stock-photo URLs from clip keywords"
    );
    return;
  }

  // Use sequential generation to reduce rate-limit bursts and preserve per-clip uniqueness.
  for (const snippet of targetSnippets) {
    if (!snippet.imagePrompt) {
      failed.push(snippet);
      continue;
    }

    const imageUrl = await generateAiImageWithRetries(snippet.imagePrompt);
    if (!imageUrl) {
      failed.push(snippet);
      continue;
    }

    await db.update(snippetsTable).set({ imageUrl }).where(eq(snippetsTable.id, snippet.id));
    generated++;
  }

  if (failed.length === 0) {
    log.info({ total: snippets.length, generated }, "Generated themed image for each slide");
    return;
  }

  log.info(
    { total: snippets.length, generated, failed: failed.length },
    "OpenAI image generation incomplete; snippets remain pending for retry"
  );
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
      page = await fetchPageDataWithHardTimeout(url);
      req.log.info({ url, bodyLen: page.bodyText.length, hasOg: !!page.ogTitle }, "Fetched page data");

      const pageError = isLikelyErrorDocument(page);
      if (pageError.isError) {
        req.log.warn({ url, reason: pageError.reason }, "URL resolved to an error document");
        res.status(400).json({
          error: "Invalid or unavailable article URL",
          detail: `This URL appears to return an error page (${pageError.reason}) instead of a full article. Open the article in your browser and copy the final working URL, or paste the article text directly.`,
        });
        return;
      }

      const extractedText = page.bodyText || page.ogDescription || page.metaDescription || "";
      if (extractedText.trim().length < 200) {
        req.log.warn(
          { url, extractedLen: extractedText.length, hasBodyText: !!page.bodyText, hasOg: !!page.ogDescription },
          "URL extraction is sparse; continuing with fallback-aware generation"
        );
      }
    }

    const generated = await generateArticleContentWithHardTimeout(url, page, req.log);
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

    // Insert snippets immediately with image URLs when stock provider is enabled,
    // otherwise placeholders are used and OpenAI generation runs in background.
    const snippetRows = await Promise.all(content.snippets.map(async (s, index) => ({
      articleId: article.id,
      snippetOrder: index,
      headline: s.headline,
      caption: s.caption,
      explanation: s.explanation,
      imageUrl: await initialClipImageUrl(
        `${article.id}:${index}`,
        s.imagePrompt || s.headline || s.caption || s.explanation || content.title,
        s.headline || s.caption || s.imagePrompt || content.title,
      ),
      imagePrompt: s.imagePrompt,
    })));

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

    // Fire-and-forget for OpenAI provider. Stock provider already sets image URLs at insert.
    if (IMAGE_PROVIDER !== "stock") {
      generateAndSaveImages(insertedSnippets, req.log).catch(err =>
        req.log.error({ err, articleId: article.id }, "Background image generation failed")
      );
    }
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
      page = await fetchPageDataWithHardTimeout(article.url);
      req.log.info({ articleId: id, url: article.url, bodyLen: page.bodyText.length }, "Regenerating chapters by re-fetching URL");
    }

    const generated = await generateArticleContentWithHardTimeout(article.url, page, req.log);
    const content = generated.content;

    // Keep the user-supplied source if they set one, otherwise use the AI source
    const resolvedSource = article.source ?? content.source;

    // Replace snippets atomically: delete old → insert new
    await db.delete(snippetsTable).where(eq(snippetsTable.articleId, id));

    const snippetRows = await Promise.all(content.snippets.map(async (s, index) => ({
      articleId: id,
      snippetOrder: index,
      headline: s.headline,
      caption: s.caption,
      explanation: s.explanation,
      imageUrl: await initialClipImageUrl(
        `${id}:${index}`,
        s.imagePrompt || s.headline || s.caption || s.explanation || content.title,
        s.headline || s.caption || s.imagePrompt || content.title,
      ),
      imagePrompt: s.imagePrompt,
    })));

    const insertedSnippets = await db.insert(snippetsTable).values(snippetRows).returning();

    // Update title/summary from the new generation
    await db.update(articlesTable)
      .set({ title: content.title, summary: content.summary, source: resolvedSource })
      .where(eq(articlesTable.id, id));

    // Respond right away — chapters are ready, images generate in background
    res.json({ id, chapters: insertedSnippets.length, title: content.title });

    if (IMAGE_PROVIDER !== "stock") {
      generateAndSaveImages(insertedSnippets, req.log).catch(err =>
        req.log.error({ err, articleId: id }, "Background image generation failed after chapter regen")
      );
    }
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

    const force =
      req.body?.force === true
      || req.query.force === "1"
      || req.query.force === "true";

    const missing = snippets.filter(s => (!s.imageUrl || isPlaceholderStoredImage(s.imageUrl)) && s.imagePrompt);
    const target = force
      ? snippets.filter(s => !!s.imagePrompt)
      : missing;

    // Respond immediately so the request never times out.
    res.json({ total: snippets.length, missing: missing.length, target: target.length, force, started: true });

    // Generate in the background using the same parallel-first strategy.
    if (target.length > 0) {
      generateAndSaveImages(target, req.log).catch(err =>
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
        hasRealImage: sql<boolean>`(${snippetsTable.imageUrl} IS NOT NULL AND ${snippetsTable.imageUrl} NOT LIKE 'data:image/svg+xml%')`,
        imageVersion: sql<string>`md5(coalesce(${snippetsTable.imageUrl}, ''))`,
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
      imageUrl: s.hasImage ? snippetImageUrlWithVersion(s.id, s.imageVersion) : null,
      imageReady: s.hasRealImage,
      imagePrompt: s.imagePrompt,
      createdAt: s.createdAt,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch snippets");
    res.status(500).json({ error: "Failed to fetch snippets" });
  }
});

export default router;
