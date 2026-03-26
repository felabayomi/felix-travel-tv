import { Router, type IRouter } from "express";

export interface QueueItem {
  type: 'article' | 'video';
  articleId?: number | null;
  videoId?: number | null;
  title: string;
}

export interface PlaybackState {
  itemType: 'article' | 'video' | 'interlude' | null;
  articleId: number | null;
  snippetIndex: number;
  videoId: number | null;
  interludeImageUrl: string | null;
  onAir: boolean;
  autoplayQueue: boolean;
  queueIndex: number;
  updatedAt: number;
}

export let playbackState: PlaybackState = {
  itemType: null,
  articleId: null,
  snippetIndex: 0,
  videoId: null,
  interludeImageUrl: null,
  onAir: false,
  autoplayQueue: false,
  queueIndex: -1,
  updatedAt: Date.now(),
};

export const broadcastQueue: QueueItem[] = [];

export function applyQueueItemAtIndex(index: number): void {
  if (index < 0 || index >= broadcastQueue.length) {
    playbackState = {
      ...playbackState,
      itemType: null, articleId: null, videoId: null,
      snippetIndex: 0, queueIndex: -1, onAir: false,
      updatedAt: Date.now(),
    };
    return;
  }
  const item = broadcastQueue[index];
  if (item.type === 'article') {
    playbackState = {
      ...playbackState,
      itemType: 'article', articleId: item.articleId ?? null,
      videoId: null, snippetIndex: 0,
      queueIndex: index, onAir: true, updatedAt: Date.now(),
    };
  } else {
    playbackState = {
      ...playbackState,
      itemType: 'video', videoId: item.videoId ?? null,
      articleId: null, snippetIndex: 0,
      queueIndex: index, onAir: true, updatedAt: Date.now(),
    };
  }
}

const router: IRouter = Router();

// ─── Playback state ───────────────────────────────────────────────────────────

router.get("/", (_req, res) => {
  res.json(playbackState);
});

router.put("/", (req, res) => {
  const b = req.body ?? {};
  if (b.itemType === 'video') {
    if (typeof b.videoId !== 'number') {
      res.status(400).json({ error: "videoId must be a number" });
      return;
    }
    playbackState = {
      ...playbackState,
      itemType: 'video', videoId: b.videoId,
      articleId: null, snippetIndex: 0,
      updatedAt: Date.now(),
    };
  } else {
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

router.patch("/", (req, res) => {
  const { onAir } = req.body ?? {};
  if (typeof onAir !== "boolean") {
    res.status(400).json({ error: "onAir must be a boolean" });
    return;
  }
  playbackState = { ...playbackState, onAir, updatedAt: Date.now() };
  res.json(playbackState);
});

// ─── Queue ────────────────────────────────────────────────────────────────────

router.get("/queue", (_req, res) => {
  res.json({
    items: broadcastQueue,
    queueIndex: playbackState.queueIndex,
    autoplayQueue: playbackState.autoplayQueue,
    onAir: playbackState.onAir,
  });
});

router.put("/queue", (req, res) => {
  const { items } = req.body ?? {};
  if (!Array.isArray(items)) { res.status(400).json({ error: "items must be an array" }); return; }
  broadcastQueue.splice(0, broadcastQueue.length, ...items);
  res.json({ items: broadcastQueue });
});

router.post("/queue/item", (req, res) => {
  const { type, articleId, videoId, title } = req.body ?? {};
  if ((type !== 'article' && type !== 'video') || typeof title !== 'string') {
    res.status(400).json({ error: "type and title required" }); return;
  }
  broadcastQueue.push({ type, articleId: articleId ?? null, videoId: videoId ?? null, title });
  res.json({ items: broadcastQueue });
});

router.delete("/queue/item/:index", (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= broadcastQueue.length) {
    res.status(400).json({ error: "invalid index" }); return;
  }
  broadcastQueue.splice(idx, 1);
  if (playbackState.queueIndex === idx) {
    playbackState = { ...playbackState, queueIndex: -1, itemType: null, articleId: null, videoId: null, updatedAt: Date.now() };
  } else if (playbackState.queueIndex > idx) {
    playbackState = { ...playbackState, queueIndex: playbackState.queueIndex - 1, updatedAt: Date.now() };
  }
  res.json({ items: broadcastQueue });
});

router.post("/queue/play/:index", (req, res) => {
  const idx = parseInt(req.params.index, 10);
  applyQueueItemAtIndex(idx);
  res.json(playbackState);
});

router.post("/queue/stop", (_req, res) => {
  playbackState = {
    ...playbackState,
    queueIndex: -1,
    onAir: false,
    itemType: null,
    articleId: null,
    videoId: null,
    interludeImageUrl: null,
    snippetIndex: 0,
    updatedAt: Date.now(),
  };
  res.json(playbackState);
});

// Set an interlude (still image) between queue items — public display handles countdown + advance
router.post("/queue/interlude", (req, res) => {
  const { imageUrl } = req.body ?? {};
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
    res.status(400).json({ error: "imageUrl required" }); return;
  }
  playbackState = {
    ...playbackState,
    itemType: 'interlude',
    interludeImageUrl: imageUrl.trim(),
    articleId: null,
    videoId: null,
    snippetIndex: 0,
    onAir: true,
    updatedAt: Date.now(),
  };
  res.json(playbackState);
});

router.post("/queue/advance", (_req, res) => {
  const next = playbackState.queueIndex + 1;
  if (playbackState.autoplayQueue && next < broadcastQueue.length) {
    applyQueueItemAtIndex(next);
  } else {
    playbackState = {
      ...playbackState,
      itemType: null, articleId: null, videoId: null,
      interludeImageUrl: null,
      snippetIndex: 0, queueIndex: -1, onAir: false,
      updatedAt: Date.now(),
    };
  }
  res.json(playbackState);
});

router.patch("/queue/autoplay", (req, res) => {
  const { autoplayQueue } = req.body ?? {};
  if (typeof autoplayQueue !== 'boolean') {
    res.status(400).json({ error: "autoplayQueue must be a boolean" }); return;
  }
  playbackState = { ...playbackState, autoplayQueue, updatedAt: Date.now() };
  res.json(playbackState);
});

router.patch("/queue/snippet", (req, res) => {
  const { snippetIndex } = req.body ?? {};
  if (typeof snippetIndex !== 'number' || snippetIndex < 0) {
    res.status(400).json({ error: "snippetIndex must be >= 0" }); return;
  }
  playbackState = { ...playbackState, snippetIndex, updatedAt: Date.now() };
  res.json(playbackState);
});

export default router;
