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

  const prompt = `You are a travel content producer for Felix Travel TV — a professional travel channel that presents content in structured, episodic TV show format.

Your job is to read the article below and break it into chapters following Felix Travel TV's standard episode formats.

URL: ${url}

${hasRichContent ? `ARTICLE CONTENT:\n${context}` : `NOTE: This article's full text could not be extracted (site may use JavaScript rendering, require login, or block bots). Use ALL of the following partial data to infer and create meaningful, specific content — do NOT write generic placeholder content:

${context || `URL path clues: ${url}`}

Even with limited data, create substantive, specific chapters that sound like real travel journalism about this actual story.`}

---

STEP 1 — DETECT THE CONTENT TYPE:
Read the article and classify it as ONE of these types:

- DESTINATION: A city, country, or region guide (e.g. "Best things to do in Tokyo")
- HOTEL_REVIEW: A hotel, resort, or accommodation review
- TRAVEL_TIPS: A tips, advice, or how-to article (e.g. "How to save money flying")
- BEFORE_YOU_BOOK: A pre-trip planning or booking guide
- EXPEDITION: An adventure, road trip, or outdoor destination feature
- TRAVEL_NEWS: A short news item, announcement, deal alert, or industry update

---

STEP 2 — BREAK THE ARTICLE INTO CHAPTERS:

Read the article fully, then divide it into chapters that follow the natural story of the content.
Do NOT apply a fixed template. Let the article decide what the chapters are.

Chapter count by type:
- DESTINATION: 6–8 chapters
- HOTEL_REVIEW: 5–7 chapters
- TRAVEL_TIPS: 5–6 chapters
- BEFORE_YOU_BOOK: 5–7 chapters
- EXPEDITION: 6–9 chapters
- TRAVEL_NEWS: 3–4 chapters

Each chapter headline must:
- Come directly from what the article is actually saying
- Be written as a compelling broadcast title for that specific piece of information
- Sound like something a presenter would say on air — vivid, specific, and engaging
- NEVER be a generic label. Words like "Introduction", "Overview", "Tips", "Advice", "Summary", "Before You Book", "Things To Do", "Best Time to Visit", "Final Thoughts", "Conclusion" are FORBIDDEN as headlines

Example of the right approach — an article about Lisbon in autumn:
- "Where Fado Music Was Born — and Still Lives" (not "Culture")
- "September to November: When the City Finally Breathes" (not "Best Time to Visit")
- "Alfama to Belém: The Neighbourhoods That Define the City" (not "Where to Stay")
- "Pastéis de Nata and the Restaurants Worth the Queue" (not "Food")

---

STEP 3 — APPLY THE CORRECT TONE & VOICE:

Each content type has a distinct voice. Match the tone to the type you detected.

DESTINATION → DOCUMENTARY STYLE (calm, cinematic, storytelling)
Write as if narrating a Discovery Channel or National Geographic documentary.
Tone: Evocative, scenic, informative. Paint a picture with words.
Example: "Nestled along the shores of Lake Michigan, Chicago rises with a boldness that is unmistakably American — a city of architecture, ambition, and extraordinary food."

HOTEL_REVIEW → TRAVEL SHOW HOST STYLE (warm, personal, guiding)
Write as if Felix is personally walking through the hotel and talking to camera.
Tone: Friendly, direct, honest. Share a genuine impression.
Example: "From the moment you walk through the doors of this hotel, you know you're in the right place. The lobby sets a confident tone — modern, spacious, and effortlessly welcoming."

TRAVEL_TIPS → TRAVEL ADVISOR STYLE (expert, helpful, practical)
Write as if Felix is giving professional advice to a client.
Tone: Clear, confident, actionable. Speak with authority.
Example: "One of the biggest mistakes travellers make is booking the cheapest flight without checking the layover time. Here's what you need to know before you click confirm."

BEFORE_YOU_BOOK → TRAVEL ADVISOR STYLE (expert, helpful, practical)
Same advisor tone — professional, structured, decision-focused. Do NOT open with "Before you book" or "Before you confirm" — start with the most compelling fact or insight instead.
Example: "Six things will make or break this trip — and most travellers only discover them after they've already paid. Getting these right will save you real money and a lot of stress."

EXPEDITION → DOCUMENTARY ADVENTURE STYLE (dramatic, inspiring, exploratory)
Write as if narrating an adventure documentary — bold, cinematic, urgent.
Tone: Epic, vivid, immersive. Make the viewer feel they are there.
Example: "This is not a destination for the faint-hearted. The trails are steep, the terrain is raw, and the rewards are extraordinary — this is what real expedition travel looks like."

TRAVEL_NEWS → NEWS ANCHOR STYLE (clear, factual, professional)
Write as if reading from a travel news bulletin.
Tone: Authoritative, concise, informative. No fluff — facts first.
Example: "Airlines operating transatlantic routes have announced a significant increase in summer capacity, with new routes expected to bring prices down for travellers booking before April."

---

STEP 4 — MATCH THE EXPLANATION DEPTH TO THE CONTENT TYPE:

Explanations must NEVER sound like Wikipedia or a generic encyclopedia.
Write like a travel advisor giving practical planning advice — always answer real traveller questions.

For every chapter, the explanation should feel like: "If you're planning a trip here, this is what you need to know."

EXPLANATION DEPTH PER CONTENT TYPE:

This is a TV broadcast — each explanation must be short enough to read aloud in under 20 seconds.
Aim for 2–3 crisp, punchy sentences maximum. Never pad. Never repeat the headline. Get straight to the point.

TRAVEL_NEWS → SHORT (1–2 sentences)
  Just the key fact and why it matters to travellers. One punchy statement, done.

TRAVEL_TIPS → SHORT (1–2 sentences)
  One clear, direct, actionable tip. No padding.

HOTEL_REVIEW → MEDIUM (2–3 sentences)
  Cover: the standout feature, who it suits, and one booking tip.

BEFORE_YOU_BOOK → MEDIUM (2–3 sentences)
  Cover: the one thing travellers miss, cost to expect, and a timing tip.

DESTINATION → MEDIUM (2–3 sentences)
  Name a specific place, what to do there, and one real insider tip.

EXPEDITION → MEDIUM (2–3 sentences)
  What makes it special, how to get there, and the one thing to know before going.

CONTENT FRAMING RULES (apply to all types):
- Always include at least one of: a real place name, a price range, a time estimate, or a practical tip
- Never write "visitors can enjoy" — say what specifically they will do and why it's worth it
- Never write "it is known for" — say what it actually is and what a traveller should expect
- NEVER repeat the phrase "Before you book" — it is overused and monotonous. Instead, vary how chapters end using different approaches each time. Rotate through endings like: a compelling reason to go, a specific insider tip, a common mistake to avoid, a price reality check, a surprising fact, the single best thing about this place, or a memorable closing line. Each chapter should land differently.
- Write as Felix Abayomi, your trusted travel advisor — knowledgeable, direct, and helpful

---

CRITICAL RULES:
- Every chapter must be specific to THIS article — not generic content
- Use all available clues (title, description, URL, structured data) to infer the full story
- Headlines must be vivid and specific to the article — never generic labels or category names
- Every headline must read like a broadcast title written for this article's actual content, not a section heading from a template
- If content is limited, draw on your training knowledge about this specific topic and destination
- Stay in the correct voice and depth for the content type throughout all chapters

---

Respond with a JSON object ONLY (no markdown, no code block):
{
  "title": "Concise, engaging headline for the full article",
  "summary": "2-3 sentence summary of what this article is about",
  "source": "The news outlet name (e.g. 'BBC Travel', 'Reuters', 'Felix Travel TV')",
  "publishedAt": "ISO 8601 date (use article date if found, otherwise: ${new Date().toISOString()})",
  "contentType": "DESTINATION | HOTEL_REVIEW | TRAVEL_TIPS | BEFORE_YOU_BOOK | EXPEDITION | TRAVEL_NEWS",
  "snippets": [
    {
      "headline": "Specific punchy chapter headline (max 10 words)",
      "caption": "One precise sentence capturing the key planning insight of this chapter",
      "explanation": "Written in the correct voice and depth for the content type — practical travel advice with real names, places, costs, and tips. Not a description. Not Wikipedia. A travel advisor talking to a real traveller.",
      "imagePrompt": "Image prompt using the correct visual style for this content type (see guide below). Must be specific to this chapter's subject — describe the exact scene, location, people, mood, lighting, and photographic style. Do NOT use generic descriptions.\n\nVISUAL STYLE GUIDE:\n- DESTINATION chapters: 'destination documentary photography of [specific place], natural lighting, realistic travel photography, National Geographic style, travel documentary, cinematic composition, street life, high detail, 4k'\n- EXPEDITION chapters: 'adventure documentary photography, [specific terrain or location], dramatic natural lighting, raw wilderness, expedition travel, Discovery Channel style, cinematic, high detail, 4k'\n- HOTEL_REVIEW chapters: 'luxury travel photography of [specific hotel feature], golden hour lighting, architecture, pool or suite interior, travel magazine style, cinematic lighting, high detail, 4k'\n- TRAVEL_TIPS and BEFORE_YOU_BOOK chapters: 'travel show photography, [specific scene e.g. traveller at airport / planning with laptop / packing suitcase], soft documentary lighting, travel advisor style, realistic, high detail'\n- TRAVEL_NEWS chapters: 'cinematic travel news photography, [specific subject], professional photojournalism, travel industry, editorial style, high detail'"
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
      ? parsed.snippets.slice(0, 8).map((s: any) => ({
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
