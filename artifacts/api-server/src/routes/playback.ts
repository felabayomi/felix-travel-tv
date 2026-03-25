import { Router, type IRouter } from "express";

export interface PlaybackState {
  articleId: number | null;
  snippetIndex: number;
  onAir: boolean;
  updatedAt: number;
}

// In-memory playback state — resets on server restart, which is acceptable
export let playbackState: PlaybackState = {
  articleId: null,
  snippetIndex: 0,
  onAir: false,
  updatedAt: Date.now(),
};

const router: IRouter = Router();

// GET /api/playback
router.get("/", (_req, res) => {
  res.json(playbackState);
});

// PUT /api/playback
router.put("/", (req, res) => {
  const { articleId, snippetIndex } = req.body ?? {};
  if (typeof snippetIndex !== "number" || snippetIndex < 0) {
    res.status(400).json({ error: "snippetIndex must be a non-negative number" });
    return;
  }
  playbackState = {
    ...playbackState,
    articleId: typeof articleId === "number" ? articleId : null,
    snippetIndex,
    updatedAt: Date.now(),
  };
  res.json(playbackState);
});

// PATCH /api/playback — toggle onAir only
router.patch("/", (req, res) => {
  const { onAir } = req.body ?? {};
  if (typeof onAir !== "boolean") {
    res.status(400).json({ error: "onAir must be a boolean" });
    return;
  }
  playbackState = { ...playbackState, onAir, updatedAt: Date.now() };
  res.json(playbackState);
});

export default router;
