import { Router, type IRouter } from "express";
import healthRouter from "./health";
import articlesRouter from "./articles";
import { db, snippetsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

// In-memory TTS cache: snippetId → mp3 Buffer
const ttsCache = new Map<number, Buffer>();

const router: IRouter = Router();

router.use(healthRouter);
router.use("/articles", articlesRouter);

// Serve snippet images at /api/snippets/:id/image
router.get("/snippets/:id/image", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }
    const rows = await db.select({ imageUrl: snippetsTable.imageUrl }).from(snippetsTable).where(eq(snippetsTable.id, id));
    if (rows.length === 0 || !rows[0].imageUrl) {
      res.status(404).end();
      return;
    }
    const dataUrl = rows[0].imageUrl;
    const base64Match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!base64Match) {
      res.status(404).end();
      return;
    }
    const mimeType = base64Match[1];
    const buffer = Buffer.from(base64Match[2], "base64");
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.send(buffer);
  } catch {
    res.status(500).end();
  }
});

// Serve snippet TTS audio at /api/snippets/:id/audio
router.get("/snippets/:id/audio", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Invalid ID" });
      return;
    }

    // Return cached audio if available
    if (ttsCache.has(id)) {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.send(ttsCache.get(id));
      return;
    }

    // Fetch snippet text from DB
    const rows = await db
      .select({ headline: snippetsTable.headline, caption: snippetsTable.caption, explanation: snippetsTable.explanation })
      .from(snippetsTable)
      .where(eq(snippetsTable.id, id));
    if (rows.length === 0) { res.status(404).end(); return; }

    const { headline, caption, explanation } = rows[0];
    const text = [headline, caption, explanation].filter(Boolean).join(". ");

    // Generate TTS via OpenAI
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: text,
      speed: 0.95,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());
    ttsCache.set(id, buffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (err) {
    res.status(500).end();
  }
});

export default router;
