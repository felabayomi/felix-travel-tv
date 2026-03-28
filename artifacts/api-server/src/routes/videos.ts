import { Router, type IRouter } from "express";
import { db, videosTable } from "@workspace/db";
import { eq, asc, desc } from "drizzle-orm";

const router: IRouter = Router();

function formatVideo(v: typeof videosTable.$inferSelect) {
  return {
    id: v.id,
    title: v.title,
    url: v.url,
    source: v.source ?? null,
    maxDurationSecs: v.maxDurationSecs,
    loop: v.loop,
    archived: v.archived,
    sortOrder: v.sortOrder,
    createdAt: v.createdAt,
  };
}

// GET /api/videos
router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(videosTable).orderBy(desc(videosTable.createdAt));
    res.json(rows.map(formatVideo));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/videos/:id
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ID" }); return; }
    const rows = await db.select().from(videosTable).where(eq(videosTable.id, id));
    if (rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json(formatVideo(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/videos
router.post("/", async (req, res) => {
  try {
    const { title, url, source, maxDurationSecs, loop } = req.body ?? {};
    if (typeof title !== "string" || !title.trim()) { res.status(400).json({ error: "title required" }); return; }
    if (typeof url !== "string" || !url.trim()) { res.status(400).json({ error: "url required" }); return; }

    const countRows = await db.select().from(videosTable);
    const sortOrder = countRows.length;

    const inserted = await db.insert(videosTable).values({
      title: title.trim(),
      url: url.trim(),
      source: typeof source === "string" && source.trim() ? source.trim() : null,
      maxDurationSecs: typeof maxDurationSecs === "number" && maxDurationSecs > 0 ? maxDurationSecs : null,
      loop: typeof loop === "boolean" ? loop : false,
      sortOrder,
    }).returning();

    res.status(201).json(formatVideo(inserted[0]));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /api/videos/:id
router.patch("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { title, url, source, maxDurationSecs, loop, archived, sortOrder } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (typeof title === "string" && title.trim()) updates.title = title.trim();
    if (typeof url === "string" && url.trim()) updates.url = url.trim();
    if (typeof loop === "boolean") updates.loop = loop;
    if (typeof archived === "boolean") updates.archived = archived;
    if (typeof sortOrder === "number") updates.sortOrder = sortOrder;
    if ("source" in req.body) {
      updates.source = typeof source === "string" && source.trim() ? source.trim() : null;
    }
    if ("maxDurationSecs" in req.body) {
      updates.maxDurationSecs = typeof maxDurationSecs === "number" && maxDurationSecs > 0 ? maxDurationSecs : null;
    }

    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No valid fields" }); return; }
    const rows = await db.update(videosTable).set(updates).where(eq(videosTable.id, id)).returning();
    if (rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
    res.json(formatVideo(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /api/videos/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid ID" }); return; }
    await db.delete(videosTable).where(eq(videosTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
