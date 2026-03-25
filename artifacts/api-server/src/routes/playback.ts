import { Router, type IRouter } from "express";

export interface PlaybackState {
  itemType: 'article' | 'video' | null;
  articleId: number | null;
  snippetIndex: number;
  videoId: number | null;
  onAir: boolean;
  updatedAt: number;
}

export let playbackState: PlaybackState = {
  itemType: null,
  articleId: null,
  snippetIndex: 0,
  videoId: null,
  onAir: false,
  updatedAt: Date.now(),
};

const router: IRouter = Router();

// GET /api/playback
router.get("/", (_req, res) => {
  res.json(playbackState);
});

// PUT /api/playback — set article or video as current item
router.put("/", (req, res) => {
  const b = req.body ?? {};

  if (b.itemType === 'video') {
    if (typeof b.videoId !== 'number') {
      res.status(400).json({ error: "videoId must be a number" });
      return;
    }
    playbackState = {
      ...playbackState,
      itemType: 'video',
      videoId: b.videoId,
      articleId: null,
      snippetIndex: 0,
      updatedAt: Date.now(),
    };
  } else {
    // article or clear
    if (typeof b.snippetIndex !== "number" || b.snippetIndex < 0) {
      res.status(400).json({ error: "snippetIndex must be a non-negative number" });
      return;
    }
    playbackState = {
      ...playbackState,
      itemType: typeof b.articleId === 'number' ? 'article' : null,
      articleId: typeof b.articleId === "number" ? b.articleId : null,
      snippetIndex: b.snippetIndex,
      videoId: null,
      updatedAt: Date.now(),
    };
  }

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
