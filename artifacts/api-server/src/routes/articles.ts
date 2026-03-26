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

  const prompt = `You are a professional news editor. Your job is to read a news article and break it into 5 to 10 rich, engaging story chapters — like a visual documentary.

URL: ${url}

${hasRichContent ? `ARTICLE CONTENT:\n${context}` : `NOTE: This article's full text could not be extracted (site may use JavaScript rendering, require login, or block bots). However, use ALL of the following partial data to infer and create meaningful, specific content about this story — do NOT give generic placeholder content:

${context || `URL path clues: ${url}`}

Even with limited data, create substantive, specific chapters that sound like real journalism about this actual story.`}

Your task: Break this article into exactly 5 to 10 chapters. Each chapter covers a DIFFERENT, SPECIFIC aspect of this particular story.

CRITICAL RULES:
- Every chapter must be about this SPECIFIC story/article — not generic news
- Use all available clues (title, description, URL keywords, structured data) to infer the full story
- Headlines must be punchy and journalistic, not vague
- Explanations must be specific and informative, not "details are emerging"
- If content is limited, use what you know about this topic from your training data

Respond with a JSON object ONLY (no markdown, no code block):
{
  "title": "Concise journalistic headline for the full article",
  "summary": "2-3 sentence summary of what this article is about",
  "source": "The news outlet name (e.g. 'BBC News', 'Reuters', 'Daily Felix')",
  "publishedAt": "ISO 8601 date (use article date if found, otherwise: ${new Date().toISOString()})",
  "snippets": [
    {
      "headline": "Specific punchy headline (max 10 words)",
      "caption": "One precise sentence with the key fact of this chapter",
      "explanation": "2-3 sentences with specific context, numbers, names, and details",
      "imagePrompt": "Detailed cinematic image prompt for this specific chapter — describe subject, setting, mood, lighting, atmosphere"
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
      ? parsed.snippets.slice(0, 10).map((s: any) => ({
          headline: s.headline || "Breaking Development",
          caption: s.caption || "Key development in this story.",
          explanation: s.explanation || "Details are emerging about this significant development.",
          imagePrompt: s.imagePrompt || "Dramatic cinematic news photograph, high contrast lighting",
        }))
      : [];

    if (snippets.length < 3) {
      throw new Error("Too few snippets generated");
    }

    return {
      title: parsed.title || "Breaking News",
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
      prompt: `Photorealistic, cinematic, high quality news photography: ${prompt}`,
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
