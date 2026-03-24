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

async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NewsReaderBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 12000);
    return text;
  } catch {
    return "";
  }
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

async function generateArticleContent(url: string, pageText: string): Promise<ArticleData> {
  const prompt = `You are a news editor analyzing a news article. Based on the URL and page content, break this article into 5 to 10 distinct news snippets — like chapters of a book. Each snippet should cover a different key point, finding, or angle of the story.

URL: ${url}

Page Content:
${pageText || "(Could not fetch page content — use the URL to infer the story)"}

Respond with a JSON object ONLY (no markdown) with these exact fields:
{
  "title": "The main headline of the article (concise, journalistic)",
  "summary": "2-3 sentence overall summary of the full article",
  "source": "The news source domain (e.g. 'BBC News', 'Reuters', 'The Guardian')",
  "publishedAt": "ISO 8601 date string if you can determine when it was published, otherwise today's date: ${new Date().toISOString()}",
  "snippets": [
    {
      "headline": "Short punchy headline for this snippet (max 10 words)",
      "caption": "One sentence that captures the key fact of this snippet",
      "explanation": "2-3 sentences expanding on this snippet with context and detail",
      "imagePrompt": "A vivid, detailed prompt for generating a photorealistic or cinematic image representing this specific snippet. Be specific about subject, mood, lighting."
    }
  ]
}

Important: Create between 5 and 10 snippets. Each snippet must be distinct and cover a different aspect of the story. Make the snippets flow logically like chapters.`;

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
    const { url } = req.body;
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL format" });
      return;
    }

    const pageText = await fetchPageContent(url);
    const content = await generateArticleContent(url, pageText);

    const [article] = await db.insert(articlesTable).values({
      url,
      title: content.title,
      summary: content.summary,
      source: content.source,
      publishedAt: new Date(content.publishedAt),
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
