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

STEP 2 — APPLY THE CORRECT CHAPTER STRUCTURE:

Use the matching structure below. Each chapter title shown is a GUIDE — adapt it to the specific content.

DESTINATION (7 chapters):
1. Introduction — Hook the viewer; set the scene
2. About the Destination — Key facts, geography, character of the place
3. Best Time to Visit — Seasons, weather, events, crowds
4. Where to Stay — Neighbourhoods, hotel types, price ranges
5. Things to Do — Top attractions, must-see sites
6. Food & Experiences — Local cuisine, nightlife, culture
7. Travel Tips & Before You Book — Visas, transport, practical advice

HOTEL_REVIEW (6 chapters):
1. Introduction — First impressions; why this hotel?
2. Location — Neighbourhood, accessibility, what's nearby
3. Rooms & Design — Room types, interiors, views, quality
4. Amenities & Services — Pool, spa, dining, concierge
5. Who Is This Hotel Best For — Couples, families, business, budget
6. Booking Tips — Best rates, when to book, what to watch out for

TRAVEL_TIPS (6 chapters):
1. Introduction — Why this tip matters
2. The Problem — What travellers get wrong
3. Why It Happens — Root cause or common mistake
4. What To Do — The correct approach, step by step
5. Pro Tips — Expert-level advice, insider tricks
6. Summary & Action — Recap and clear call to action

BEFORE_YOU_BOOK (6 chapters):
1. Introduction — Overview of the trip or destination
2. Trip Overview — Highlights and what to expect
3. Flights — Best airlines, routes, timing, cost tips
4. Hotels — Recommended stays, price ranges, location tips
5. Transport & Activities — Getting around, must-do experiences
6. Final Advice — Last checks before confirming the booking

EXPEDITION (8 chapters):
1. Introduction — The adventure begins; hook the viewer
2. Location Overview — Where it is and why it's special
3. How To Get There — Transport, access, logistics
4. Best Time To Go — Seasons, conditions, peak vs. off-peak
5. Where To Stay — Camps, lodges, or overnight options
6. Things To Do — Activities, highlights, bucket list moments
7. What To Pack — Gear, clothing, essentials
8. Travel Tips — Safety, booking advice, final checklist

TRAVEL_NEWS (3–4 chapters):
1. The Story — What happened or what was announced
2. Why It Matters — Impact for travellers
3. What To Do Next — How travellers can act on this
4. (Optional) Background — Context or history if relevant

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
Same advisor tone — professional, structured, decision-focused.
Example: "Before you confirm any booking for this trip, there are six things you need to check. Getting these right will save you money, time, and stress."

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
- End destination and expedition chapters with a "Before you book" tip where natural
- Write as Felix Abayomi, your trusted travel advisor — knowledgeable, direct, and helpful

---

CRITICAL RULES:
- Every chapter must be specific to THIS article — not generic content
- Use all available clues (title, description, URL, structured data) to infer the full story
- Headlines must be punchy and specific — never vague
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
  } catch {
    return null;
  }
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

    // Generate images for all snippets in parallel
    const snippetRows = await Promise.all(
      content.snippets.map(async (s, index) => {
        const imageUrl = await generateImage(s.imagePrompt).catch(() => null);
        return {
          articleId: article.id,
          snippetOrder: index,
          headline: s.headline,
          caption: s.caption,
          explanation: s.explanation,
          imageUrl,
          imagePrompt: s.imagePrompt,
        };
      })
    );

    await db.insert(snippetsTable).values(snippetRows);

    res.status(201).json(formatArticle(article, snippetRows.length));
  } catch (err) {
    req.log.error({ err }, "Failed to create article");
    res.status(422).json({ error: "Failed to process URL" });
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

    const snippets = await db
      .select()
      .from(snippetsTable)
      .where(eq(snippetsTable.articleId, id))
      .orderBy(asc(snippetsTable.snippetOrder));

    res.json(snippets.map(formatSnippet));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch snippets");
    res.status(500).json({ error: "Failed to fetch snippets" });
  }
});

export default router;
