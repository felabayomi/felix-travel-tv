import { Router, type IRouter } from "express";
import { db, slidesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { CreateSlideBody, ReorderSlideBody, ReorderSlideParams, DeleteSlideParams } from "@workspace/api-zod";

const router: IRouter = Router();

async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TravelShowcaseBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    // Strip HTML tags and compress whitespace for text extraction
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 6000);
    return text;
  } catch {
    return "";
  }
}

async function generateSlideContent(url: string, pageText: string): Promise<{
  title: string;
  tagline: string;
  summary: string;
  category: string;
  imagePrompt: string;
}> {
  const prompt = `You are analyzing a travel product webpage. Based on the URL and page content below, extract key information.

URL: ${url}

Page Content (truncated):
${pageText || "(Could not fetch page content — use the URL to infer)"}

Respond with a JSON object ONLY (no markdown) with these exact fields:
{
  "title": "Short product name (max 6 words)",
  "tagline": "Exciting one-line tagline that captures the essence (max 12 words)",
  "summary": "2-3 sentence description of what this product does and why it's exciting for travelers",
  "category": "One of: Navigation, Itinerary, Discover, News, Live, Expedition, Tours, or other relevant single word",
  "imagePrompt": "A vivid, detailed prompt for generating a beautiful travel photo that represents this product. Describe a specific destination, scene, or atmosphere. Be specific about lighting, mood, and visual elements."
}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const content = response.choices[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content);
    return {
      title: parsed.title || "Travel Product",
      tagline: parsed.tagline || "Explore the world",
      summary: parsed.summary || "An exciting travel product.",
      category: parsed.category || "Travel",
      imagePrompt: parsed.imagePrompt || "Beautiful travel destination with dramatic lighting",
    };
  } catch {
    return {
      title: "Travel Product",
      tagline: "Explore the world",
      summary: "An exciting travel product.",
      category: "Travel",
      imagePrompt: "Beautiful scenic travel destination at golden hour",
    };
  }
}

async function generateImage(prompt: string): Promise<string | null> {
  try {
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: `Travel photography, cinematic, high quality: ${prompt}`,
      size: "1024x1024",
    });
    const b64 = response.data?.[0]?.b64_json;
    if (!b64) return null;
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}

// GET /api/slides
router.get("/", async (req, res) => {
  try {
    const slides = await db
      .select()
      .from(slidesTable)
      .orderBy(asc(slidesTable.displayOrder), asc(slidesTable.createdAt));
    res.json(slides.map(s => ({
      id: s.id,
      url: s.url,
      title: s.title,
      tagline: s.tagline,
      summary: s.summary,
      imageUrl: s.imageUrl,
      imagePrompt: s.imagePrompt,
      displayOrder: s.displayOrder,
      category: s.category,
      createdAt: s.createdAt,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch slides");
    res.status(500).json({ error: "Failed to fetch slides" });
  }
});

// POST /api/slides
router.post("/", async (req, res) => {
  try {
    const parsed = CreateSlideBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const { url } = parsed.data;

    // Validate URL format
    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL format" });
      return;
    }

    // Fetch page content
    const pageText = await fetchPageContent(url);

    // Generate slide content with AI
    const content = await generateSlideContent(url, pageText);

    // Generate image in background (don't block response)
    let imageUrl: string | null = null;
    try {
      imageUrl = await generateImage(content.imagePrompt);
    } catch (err) {
      req.log.warn({ err }, "Image generation failed, continuing without image");
    }

    // Get max display order
    const existing = await db.select({ displayOrder: slidesTable.displayOrder }).from(slidesTable).orderBy(asc(slidesTable.displayOrder));
    const maxOrder = existing.length > 0 ? Math.max(...existing.map(s => s.displayOrder)) : -1;

    const [slide] = await db.insert(slidesTable).values({
      url,
      title: content.title,
      tagline: content.tagline,
      summary: content.summary,
      imageUrl,
      imagePrompt: content.imagePrompt,
      category: content.category,
      displayOrder: maxOrder + 1,
    }).returning();

    res.status(201).json({
      id: slide.id,
      url: slide.url,
      title: slide.title,
      tagline: slide.tagline,
      summary: slide.summary,
      imageUrl: slide.imageUrl,
      imagePrompt: slide.imagePrompt,
      displayOrder: slide.displayOrder,
      category: slide.category,
      createdAt: slide.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create slide");
    res.status(422).json({ error: "Failed to process URL" });
  }
});

// DELETE /api/slides/:id
router.delete("/:id", async (req, res) => {
  try {
    const parsed = DeleteSlideParams.safeParse({ id: Number(req.params.id) });
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const result = await db.delete(slidesTable).where(eq(slidesTable.id, parsed.data.id)).returning();
    if (result.length === 0) {
      res.status(404).json({ error: "Slide not found" });
      return;
    }
    res.status(204).end();
  } catch (err) {
    req.log.error({ err }, "Failed to delete slide");
    res.status(500).json({ error: "Failed to delete slide" });
  }
});

// PATCH /api/slides/:id/reorder
router.patch("/:id/reorder", async (req, res) => {
  try {
    const paramsParsed = ReorderSlideParams.safeParse({ id: Number(req.params.id) });
    const bodyParsed = ReorderSlideBody.safeParse(req.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const [updated] = await db
      .update(slidesTable)
      .set({ displayOrder: bodyParsed.data.displayOrder })
      .where(eq(slidesTable.id, paramsParsed.data.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Slide not found" });
      return;
    }
    res.json({
      id: updated.id,
      url: updated.url,
      title: updated.title,
      tagline: updated.tagline,
      summary: updated.summary,
      imageUrl: updated.imageUrl,
      imagePrompt: updated.imagePrompt,
      displayOrder: updated.displayOrder,
      category: updated.category,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to reorder slide");
    res.status(500).json({ error: "Failed to reorder slide" });
  }
});

export default router;
