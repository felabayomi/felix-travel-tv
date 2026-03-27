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

async function generateArticleContent(url: string, page: PageData): Promise<ArticleData> {
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

Your job is to transform the article below into a structured Felix Travel TV episode using the Content Engine Logic below. Follow every step in order.

URL: ${url}

${hasRichContent ? `ARTICLE CONTENT:\n${context}` : `NOTE: This article's full text could not be extracted. Use the partial data below plus your own knowledge of this specific destination or topic to create substantive, specific content. Do NOT write generic placeholder text.

${context || `URL path clues: ${url}`}`}

---

STEP 1 — CLASSIFY THE CONTENT

Read the article and assign ONE content type:

- CITY_DISCOVERY: A city or town guide focused on experiences in that place
- DESTINATION_FEATURE: A broader destination, country, or region feature
- TRAVEL_DEAL: A deal, offer, pricing announcement, or trip package
- TRAVEL_TOOL: An app, service, website, or travel product feature
- ROAD_TRIP: A route, road trip, or multi-stop journey feature
- TRAVEL_TIPS: Advice, how-to, or planning guidance

---

STEP 2 — EXTRACT THE KEY INFORMATION

From the article (and your own knowledge if needed), identify:
- location (city, country, region)
- morning_experiences (what to do, see, eat in the morning)
- afternoon_experiences (afternoon activities, sights, places)
- evening_experiences (evening dining, nightlife, atmosphere)
- food_and_culture (cuisine, local culture, markets, traditions)
- luxury_and_upgrades (premium experiences, upscale stays, splurge options)
- nature_and_extras (outdoor experiences, side trips, unique activities)
- practical_tips (pricing, timing, transport, booking advice, facts)
- target_traveler (who this trip is ideal for)

---

STEP 3 — BUILD THE EPISODE CHAPTERS

Always produce exactly 9 chapters in this fixed order. Every chapter must be based on the extracted information above. If a specific field is sparse, draw on your knowledge of this destination or topic.

Chapter 1 — INTRODUCTION: Hook the viewer. Open with the most compelling fact, scene, or reason to care about this destination or story. Set the scene powerfully.

Chapter 2 — MORNING: What the morning experience looks, feels, and tastes like. First impressions, morning activities, breakfast spots, early sights.

Chapter 3 — AFTERNOON: The heart of the day. Key attractions, experiences, and activities that define this destination in the afternoon.

Chapter 4 — EVENING: How the destination transforms after dark. Evening dining, nightlife, atmosphere, sunset spots.

Chapter 5 — TIPS & FACTS: The practical intelligence every traveller needs. Real prices, timing, transport, what to avoid, insider knowledge.

Chapter 6 — LUXURY & UPGRADES: The premium layer. Best hotels, upscale experiences, splurge-worthy options, and why they're worth it.

Chapter 7 — NATURE & EXTRA EXPERIENCES: What exists beyond the obvious. Outdoor adventures, hidden gems, unusual activities, side trips.

Chapter 8 — ADVISOR INSIGHT: Felix Travel TV's expertise. This is where Felix speaks directly — explaining how Felix Travel TV helps travellers plan flights, book hotels, build itineraries, save time, and travel with confidence. Always personalised, always authoritative.

Chapter 9 — CALL TO ACTION: The close. Inspire the viewer to take action — book the trip, start planning, reach out to Felix Travel TV. Make it compelling and specific to this destination.

---

STEP 4 — WRITE EACH CHAPTER

For each of the 9 chapters, write:

HEADLINE: A vivid, broadcast-quality title specific to this article's content. The headline must reflect exactly what the chapter covers — never a generic label.

FORBIDDEN headline words: "Introduction", "Morning", "Afternoon", "Evening", "Tips", "Facts", "Luxury", "Nature", "Advisor", "Call to Action", "Overview", "Conclusion", "Summary"

GOOD headline examples:
- Chapter 1: "The City That Rewrites Every Expectation" / "Why Santiago Is the Story Everyone Is Missing"
- Chapter 2: "The Souk at Sunrise — When the City Belongs to You" / "First Coffee, First Cobblestone, First Wonder"
- Chapter 5: "€85 a Night, Rooftop Included — Here Is What to Know" / "The One Booking Mistake That Costs Most Travellers"
- Chapter 8: "Felix Travel TV Plans the Trip You Have Been Dreaming Of" / "From Flights to Itinerary — We Handle the Detail"
- Chapter 9: "Your Next Chapter Starts Here — Book With Felix Travel TV" / "The Trip Is Real. The Only Question Is When"

EXPLANATION: 2–3 crisp sentences written as Felix Abayomi speaking to camera. Warm, authoritative, direct. No filler. No Wikipedia. Speak like a trusted advisor giving real, specific, useful information. Read aloud in under 20 seconds.

VOICE: Throughout all chapters, Felix speaks as a knowledgeable, confident travel advisor — descriptive for destination chapters, practical for tips, inspiring for the call to action.

---

CRITICAL RULES:
- All 9 chapters are required — never skip one
- Every chapter must be specific to THIS article and destination — not generic
- If article content is thin, use your knowledge of this specific place or topic
- Headlines must be vivid broadcast titles — never section labels
- Explanations must never repeat the headline
- Always include real place names, real prices, real timing where possible
- Chapter 8 must always reference Felix Travel TV by name and describe the service
- Chapter 9 must always end with a clear, compelling invitation to book or plan

---

Respond with a JSON object ONLY (no markdown, no code block):
{
  "title": "Concise, engaging headline for the full episode",
  "summary": "2-3 sentence summary of what this episode covers",
  "source": "The source outlet name (e.g. 'BBC Travel', 'Reuters', 'Felix Travel TV')",
  "publishedAt": "ISO 8601 date (use article date if found, otherwise: ${new Date().toISOString()})",
  "contentType": "CITY_DISCOVERY | DESTINATION_FEATURE | TRAVEL_DEAL | TRAVEL_TOOL | ROAD_TRIP | TRAVEL_TIPS",
  "snippets": [
    {
      "headline": "Vivid broadcast chapter title (max 12 words)",
      "caption": "One precise sentence capturing the key insight of this chapter",
      "explanation": "2-3 sentences in Felix's voice — specific, warm, authoritative, useful. Real places, real prices, real advice.",
      "imagePrompt": "Photorealistic travel photography prompt specific to this chapter's exact content. Describe the precise scene, location, people, mood, lighting, and style. Choose the correct visual approach: destination/city chapters use 'cinematic travel documentary photography, [specific scene], natural lighting, National Geographic style, high detail, 4k'; evening/culture chapters use 'warm evening travel photography, [specific scene], golden hour, atmospheric lighting, lifestyle, high detail'; luxury chapters use 'luxury travel photography, [specific hotel or experience], editorial style, soft lighting, aspirational, high detail'; tips/practical chapters use 'travel lifestyle photography, [specific practical scene], soft documentary lighting, realistic, relatable, high detail'; advisor/CTA chapters use 'professional travel advisor photography, Felix Travel TV style, warm confident presenter energy, broadcast quality'"
    }
  ]
}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  try {
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
      title: parsed.title || "Felix Travel TV Feature",
      summary: parsed.summary || "An important story is developing.",
      source: parsed.source || new URL(url).hostname.replace(/^www\./, ""),
      publishedAt: parsed.publishedAt || new Date().toISOString(),
      snippets,
    };
  } catch {
    return {
      title: "Breaking News",
      summary: "An important story is developing.",
      source: new URL(url).hostname.replace(/^www\./, ""),
      publishedAt: new Date().toISOString(),
      snippets: [
        {
          headline: "Story Loading",
          caption: "Content is being processed.",
          explanation: "The article content could not be fully parsed. Please try adding the URL again.",
          imagePrompt: "Newspaper press room, dramatic lighting, ink and paper",
        },
      ],
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
      .orderBy(desc(articlesTable.publishedAt));

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

    if (text && typeof text === "string" && text.trim().length > 100) {
      // User pasted the article text directly — use it as the body
      const domain = new URL(url).hostname.replace(/^www\./, "");
      page = {
        html: "",
        metaTitle: titleOverride || "",
        metaDescription: "",
        ogTitle: titleOverride || "",
        ogDescription: "",
        ogImage: "",
        publishedTime: "",
        author: "",
        jsonLd: "",
        bodyText: text.trim().slice(0, 12000),
      };
      req.log.info({ url, textLen: text.trim().length, source: sourceOverride || domain }, "Using pasted text");
    } else {
      // No text provided — try to fetch the URL
      page = await fetchPageData(url);
      req.log.info({ url, bodyLen: page.bodyText.length, hasOg: !!page.ogTitle }, "Fetched page data");
    }

    const content = await generateArticleContent(url, page);
    if (sourceOverride && typeof sourceOverride === "string") {
      content.source = sourceOverride;
    }

    // Use user-supplied date if provided, otherwise trust AI-detected date
    let resolvedDate: Date;
    if (publishedDate && typeof publishedDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(publishedDate)) {
      resolvedDate = new Date(publishedDate + "T12:00:00Z");
    } else {
      resolvedDate = new Date(content.publishedAt);
    }

    const [article] = await db.insert(articlesTable).values({
      url,
      title: content.title,
      summary: content.summary,
      source: content.source,
      publishedAt: resolvedDate,
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
    res.status(201).json(formatArticle(article, insertedSnippets.length));

    // Fire-and-forget: generate images in the background (parallel-first, then
    // sequential retry for any that failed). Never blocks the HTTP response.
    generateAndSaveImages(insertedSnippets, req.log).catch(err =>
      req.log.error({ err, articleId: article.id }, "Background image generation failed")
    );
  } catch (err) {
    req.log.error({ err }, "Failed to create article");
    res.status(422).json({ error: "Failed to process URL" });
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

    // Re-fetch the page and regenerate chapters using the current prompt
    const page = await fetchPageData(article.url);
    req.log.info({ url: article.url, bodyLen: page.bodyText.length }, "Regenerating chapters");

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
