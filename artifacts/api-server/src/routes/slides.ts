import { Router, type IRouter } from "express";
import { db, slidesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { CreateSlideBody, ReorderSlideBody, ReorderSlideParams, DeleteSlideParams, UpdateSlideParams, UpdateSlideBody, RegenerateSlideParams, RegenerateSlideBody } from "@workspace/api-zod";

const router: IRouter = Router();

async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ProductShowcaseBot/1.0)",
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
  const prompt = `You are analyzing a product or service webpage. Based on the URL and page content below, extract key information.

URL: ${url}

Page Content (truncated):
${pageText || "(Could not fetch page content — use the URL to infer)"}

This could be ANY type of product or service: technology, finance, education, wildlife, productivity, travel, news, health, entertainment, etc.

Respond with a JSON object ONLY (no markdown) with these exact fields:
{
  "title": "Short product/service name (max 6 words)",
  "tagline": "Compelling one-line tagline that captures the essence (max 12 words)",
  "summary": "2-3 sentence description of what this product/service does and why it is valuable or exciting",
  "category": "A single relevant category word that fits the domain (e.g. Finance, Technology, Education, Wildlife, Productivity, Navigation, News, Health, Expedition, Discovery, or any other fitting word)",
  "imagePrompt": "A vivid, detailed prompt for generating a striking visual image that represents this product/service. Think about the domain and audience — could be a scenic photo, a dramatic workspace, wildlife, a city skyline, futuristic tech, etc. Be specific about subject, lighting, mood, and atmosphere."
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
      title: parsed.title || "Product",
      tagline: parsed.tagline || "Discover something new",
      summary: parsed.summary || "An exciting product or service.",
      category: parsed.category || "Discovery",
      imagePrompt: parsed.imagePrompt || "Dramatic cinematic scene with vivid lighting",
    };
  } catch {
    return {
      title: "Product",
      tagline: "Discover something new",
      summary: "An exciting product or service.",
      category: "Discovery",
      imagePrompt: "Dramatic cinematic scene with vivid lighting",
    };
  }
}

async function generateImage(prompt: string): Promise<string | null> {
  try {
    const response = await openai.images.generate({
      model: "gpt-image-1",
      prompt: `Cinematic, high quality, visually striking: ${prompt}`,
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

// PATCH /api/slides/:id — edit slide content
router.patch("/:id", async (req, res) => {
  try {
    const paramsParsed = UpdateSlideParams.safeParse({ id: Number(req.params.id) });
    const bodyParsed = UpdateSlideBody.safeParse(req.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }
    const updates: Record<string, string> = {};
    const { title, tagline, summary, category } = bodyParsed.data;
    if (title !== undefined) updates.title = title;
    if (tagline !== undefined) updates.tagline = tagline;
    if (summary !== undefined) updates.summary = summary;
    if (category !== undefined) updates.category = category;

    const [updated] = await db
      .update(slidesTable)
      .set(updates)
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
    req.log.error({ err }, "Failed to update slide");
    res.status(500).json({ error: "Failed to update slide" });
  }
});

// POST /api/slides/:id/regenerate — regenerate text content from a hint
router.post("/:id/regenerate", async (req, res) => {
  try {
    const paramsParsed = RegenerateSlideParams.safeParse({ id: Number(req.params.id) });
    const bodyParsed = RegenerateSlideBody.safeParse(req.body);
    if (!paramsParsed.success || !bodyParsed.success) {
      res.status(400).json({ error: "Invalid input" });
      return;
    }

    const existing = await db.select().from(slidesTable).where(eq(slidesTable.id, paramsParsed.data.id));
    if (existing.length === 0) {
      res.status(404).json({ error: "Slide not found" });
      return;
    }

    const slide = existing[0];
    const { hint } = bodyParsed.data;

    const prompt = `You are generating showcase content for a product or service.

URL: ${slide.url}
User's description: "${hint}"

Use the user's description as the primary source of truth. Ignore any previous assumptions about the product.

Respond with a JSON object ONLY (no markdown) with these exact fields:
{
  "title": "Short product/service name (max 6 words)",
  "tagline": "Compelling one-line tagline that captures the essence (max 12 words)",
  "summary": "2-3 sentence description of what this product/service does and why it is valuable or exciting",
  "category": "A single relevant category word (e.g. Finance, Technology, Education, Health, Productivity, Travel, etc.)"
}`;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = aiResponse.choices[0]?.message?.content ?? "{}";
    let generated: { title: string; tagline: string; summary: string; category: string };
    try {
      const parsed = JSON.parse(raw);
      generated = {
        title: parsed.title || slide.title,
        tagline: parsed.tagline || slide.tagline,
        summary: parsed.summary || slide.summary || "",
        category: parsed.category || slide.category,
      };
    } catch {
      res.status(500).json({ error: "AI returned unexpected content" });
      return;
    }

    const [updated] = await db
      .update(slidesTable)
      .set(generated)
      .where(eq(slidesTable.id, paramsParsed.data.id))
      .returning();

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
    req.log.error({ err }, "Failed to regenerate slide");
    res.status(500).json({ error: "Failed to regenerate slide" });
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
