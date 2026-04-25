import { Router, type IRouter } from "express";
import { db, articlesTable, snippetsTable } from "@workspace/db";
import { eq, asc, desc, sql, inArray } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

const router: IRouter = Router();

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
  const empty: PageData = { html: "", metaTitle: "", metaDescription: "", ogTitle: "", ogDescription: "", ogImage: "", publishedTime: "", author: "", jsonLd: "", bodyText: "" };

  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
  ];

  let html = "";
  for (const ua of userAgents) {
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
        signal: AbortSignal.timeout(20000),
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
  const jsonLd = jsonLdMatches.map(m => m[1]).join("\n").slice(0, 3000);

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
    .slice(0, 8000);

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

const ARTICLE_MODEL = process.env.TRAVEL_TV_ARTICLE_MODEL || "gpt-5.4";

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
  log?: { warn: (...args: any[]) => void },
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

  const prompt = `You are a travel content producer for Felix Travel TV — a professional travel channel presented by Felix Abayomi, trusted travel advisor.

Your job is to transform the article below into a structured Felix Travel TV episode. Follow every step precisely.

URL: ${url}

${hasRichContent ? `ARTICLE CONTENT:\n${context}` : `NOTE: This article's full text could not be extracted. Use the partial data below plus your own knowledge of this specific topic to create substantive content. Do NOT write generic placeholder text.

${context || `URL clues: ${url}`}`}

---

STEP 1 — DETECT CONTENT TYPE

Read the article and classify it as ONE of:

- CITY_GUIDE — content about a specific city or town and its experiences
- DESTINATION_FEATURE — a broader destination, country, or region feature
- TRAVEL_DEAL — a deal, trip package, pricing offer, or booking promotion
- TRAVEL_TOOL — an app, website, service, or travel product
- ROAD_TRIP — a route, multi-stop journey, or driving feature
- TRAVEL_TIPS — advice, how-to, or planning guidance
- HOTEL_FEATURE — a hotel, resort, or accommodation review
- CRUISE_FEATURE — a cruise line, ship, or sailing experience
- GENERAL_TRAVEL — any other travel content

---

STEP 2 — SELECT THE MATCHING TEMPLATE

Based on the content type, use the correct template below. The template defines what each chapter must cover. Map the article's information into each section. If a section's data is missing from the article, draw on your own knowledge of the subject.

TEMPLATE A — CITY_GUIDE (7 chapters):
1. Overview — What makes this city unique and worth visiting
2. Main Areas & Highlights — The key neighbourhoods, districts, and must-see spots
3. Food & Culture — Local cuisine, markets, cultural traditions, and dining scenes
4. Experiences & Activities — What to do, see, and explore
5. Where to Stay — Accommodation options, neighbourhoods to base yourself, price ranges
6. Travel Tips — Practical advice: transport, costs, timing, what to know before going
7. Felix, Your Travel Advisor — How Felix, as your personal travel agent and advisor, helps you plan and book this city trip; call to action

TEMPLATE B — DESTINATION_FEATURE (7 chapters):
1. Introduction — Why this destination matters and what the story is about
2. Why Visit — The compelling reasons and unique appeal of this destination
3. Top Experiences — The standout things to do, see, and feel here
4. Food & Culture — Cuisine, local life, cultural highlights
5. Best Time to Visit — Seasons, weather, events, and practical timing advice
6. Travel Planning Tips — Flights, logistics, costs, how to prepare
7. Felix, Your Travel Advisor — How Felix, as your personal travel agent and advisor, makes planning this trip effortless; call to action

TEMPLATE C — TRAVEL_DEAL (7 chapters):
1. Trip Overview — What this deal or trip package is, where it goes, who offers it
2. What's Included — Everything covered: hotels, flights, activities, meals, transfers
3. Dates & Pricing — The available dates, price points, and how to secure the rate
4. Highlights — The most exciting moments and experiences on this trip
5. Who This Trip Is For — The ideal traveller profile: families, couples, adventurers, etc.
6. Booking Information — How to book, deadlines, contact details, what to do next
7. Felix, Your Travel Advisor — Why Felix, as your personal travel agent and advisor, is the right partner for this deal; call to action

TEMPLATE D — TRAVEL_TOOL (7 chapters):
1. The Problem — The travel challenge or frustration this tool solves
2. The Solution — What this app, service, or tool is and what it does
3. How It Works — Step-by-step explanation of the product
4. Key Features — The standout capabilities and what makes it different
5. Who It's For — The traveller types who benefit most
6. Pricing & Access — Cost, free tier, subscription details, where to get it
7. Felix, Your Travel Advisor — Felix's personal recommendation and how to start using it with his guidance; call to action

TEMPLATE E — ROAD_TRIP (7 chapters):
1. Route Overview — Where the journey starts, ends, and what it covers
2. Major Stops — The key destinations and places along the route
3. Scenic Highlights — The most beautiful or dramatic moments on the road
4. Food Stops — Where to eat, drink, and experience local flavour along the way
5. Travel Tips — Driving advice, logistics, costs, best season, what to book ahead
6. Recommended Schedule — A practical day-by-day or leg-by-leg breakdown
7. Felix, Your Travel Advisor — How Felix, as your personal travel agent and advisor, helps you plan and book this road trip; call to action

TEMPLATE F — TRAVEL_TIPS (6 chapters):
1. The Problem — The common travel mistake, challenge, or gap this addresses
2. The Tips — The specific, actionable advice every traveller needs to know
3. Real Examples — Concrete scenarios, case studies, or practical illustrations
4. What to Avoid — The mistakes, traps, and wrong assumptions to steer clear of
5. Recommendations — Felix's personal recommendations and trusted options
6. Felix, Your Travel Advisor — How to put these tips into action with Felix as your personal travel agent and advisor; call to action

TEMPLATE G — HOTEL_FEATURE (7 chapters):
1. Hotel Overview — First impressions: what this property is, its positioning, its personality
2. Location — Neighbourhood, accessibility, what's on the doorstep
3. Rooms & Design — Room categories, interiors, views, quality, standout features
4. Dining — Restaurants, bars, breakfast, room service, signature dishes
5. Amenities — Pool, spa, gym, concierge, services, what sets it apart
6. Who It's For — The ideal guest: couples, families, business, luxury seekers
7. Felix, Your Travel Advisor — Booking tips, best rates, and how Felix, as your personal travel agent and advisor, secures this hotel for you; call to action

TEMPLATE H — CRUISE_FEATURE (7 chapters):
1. Cruise Overview — The line, ship, itinerary, and what kind of experience this is
2. Ship Experience — Size, atmosphere, onboard highlights, what life is like at sea
3. Destinations & Ports — Where the cruise goes and what to do at each stop
4. Dining & Entertainment — Food quality, restaurants, shows, and onboard activities
5. Cabins — Cabin categories, sizes, views, pricing tiers
6. Who It's For — Families, couples, first-timers, luxury cruisers — who belongs on this ship
7. Felix, Your Travel Advisor — How Felix, as your personal travel agent and advisor, books cruises and why travellers trust him; call to action

TEMPLATE I — GENERAL_TRAVEL (6 chapters):
1. The Story — What this piece of travel content is about and why it matters
2. Key Insights — The most important facts, findings, or revelations
3. What It Means for Travellers — How this affects travel plans, decisions, or experiences
4. Practical Takeaways — What travellers should actually do with this information
5. Felix's Perspective — Felix Abayomi's expert take and personal recommendation
6. Felix, Your Travel Advisor — How Felix, as your personal travel agent and advisor, helps travellers act on this; call to action

---

STEP 3 — WRITE EACH CHAPTER

For every chapter in the selected template, produce:

HEADLINE: A vivid, broadcast-quality title written specifically for this article's content.
- Must reflect exactly what THIS chapter covers — not a generic label
- Must sound like something Felix would say on air — specific, punchy, engaging
- NEVER use the template section names literally as headlines
- Forbidden words as standalone headlines: "Overview", "Introduction", "Tips", "Summary", "Conclusion", "Highlights", "Features", "Amenities", "Dining", "Location"

GOOD headline examples by chapter purpose:
- City overview: "The Pocket-Sized Capital That Punches Way Above Its Weight"
- Food: "Tagines, Rooftops, and the Street Food Trail That Changes Everything"
- Deal pricing: "Seven Nights in Ireland — $4,045 All In, and Worth Every Cent"
- Hotel: "From the Moment You Walk Through the Door, This Hotel Gets It Right"
- Who it's for: "Built for Families Who Want the Magic Without the Stress"
- Felix CTA: "Felix, Your Travel Agent and Advisor — You Just Show Up and Enjoy"

EXPLANATION: 2–3 crisp sentences in Felix Abayomi's voice — warm, direct, authoritative, specific. No filler. No Wikipedia language. Speak like a trusted advisor giving real, useful information. Must be readable aloud in under 20 seconds.

IMAGE PROMPT: A photorealistic travel photography description specific to this chapter's exact subject. Describe the precise scene, location, atmosphere, people, lighting, and photographic style. Never generic — always specific to the chapter content.

---

CRITICAL RULES:
- Produce ALL chapters required by the selected template — never skip one
- Every chapter must be grounded in THIS article's actual content
- If the article lacks detail for a section, use your knowledge of the specific subject
- The final chapter of every template is always Felix as your personal travel agent and advisor + call to action
- Headlines must be vivid broadcast titles, never template section labels
- Explanations must never repeat the headline word for word
- Always include real names, real prices, and real specifics wherever possible

---

Respond with a JSON object ONLY (no markdown, no code block):
{
  "title": "Concise, engaging headline for the full episode",
  "summary": "2-3 sentence summary of what this episode covers",
  "source": "The source outlet name (e.g. 'BBC Travel', 'Reuters', 'Felix Travel TV')",
  "publishedAt": "ISO 8601 date (use article date if found, otherwise: ${new Date().toISOString()})",
  "contentType": "CITY_GUIDE | DESTINATION_FEATURE | TRAVEL_DEAL | TRAVEL_TOOL | ROAD_TRIP | TRAVEL_TIPS | HOTEL_FEATURE | CRUISE_FEATURE | GENERAL_TRAVEL",
  "snippets": [
    {
      "headline": "Vivid broadcast chapter title (max 12 words)",
      "caption": "One precise sentence capturing the key insight of this chapter",
      "explanation": "2-3 sentences in Felix's voice — specific, warm, authoritative. Real places, real prices, real advice.",
      "imagePrompt": "Detailed photorealistic photography prompt specific to this chapter's exact content and subject"
    }
  ]
}`;

  try {
    const response = await openai.chat.completions.create({
      model: ARTICLE_MODEL,
      max_completion_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });

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
      size: "1024x1024",
    });
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) return null;
    return `data:image/png;base64,${b64}`;
  } catch (err: any) {
    return null;
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
  // ── Pass 1: parallel ──────────────────────────────────────────────────────
  const results = await Promise.allSettled(
    snippets.map(async (snippet) => {
      if (!snippet.imagePrompt) return { id: snippet.id, ok: false };
      const imageUrl = await generateImage(snippet.imagePrompt);
      if (imageUrl) {
        await db.update(snippetsTable).set({ imageUrl }).where(eq(snippetsTable.id, snippet.id));
        return { id: snippet.id, ok: true };
      }
      return { id: snippet.id, ok: false };
    })
  );

  const failed = snippets.filter((_, i) => {
    const r = results[i];
    return r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok);
  });

  if (failed.length === 0) {
    log.info({ total: snippets.length }, "Image generation complete (all parallel)");
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

  log.info({ total: snippets.length, retried }, "Image generation complete (with retries)");
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
        metaPage = await fetchPageData(url);
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
        bodyText: text.trim().slice(0, 12000),
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
      imageUrl: null as string | null,
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
      imageUrl: null as string | null,
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
