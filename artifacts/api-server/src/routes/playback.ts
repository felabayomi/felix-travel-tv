import { Router, type IRouter } from "express";
import { db, snippetsTable } from "@workspace/db";
import { eq, isNotNull, and } from "drizzle-orm";

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
  loopQueue: boolean;
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
  loopQueue: false,
  queueIndex: -1,
  updatedAt: Date.now(),
};

export const broadcastQueue: QueueItem[] = [];

// ─── Interlude timer ──────────────────────────────────────────────────────────

const INTERLUDE_DURATION_MS = 30_000;
let interludeTimer: ReturnType<typeof setTimeout> | null = null;

function clearInterludeTimer() {
  if (interludeTimer !== null) {
    clearTimeout(interludeTimer);
    interludeTimer = null;
  }
}

function resolveNextIndex(currentIndex: number): number | null {
  const next = currentIndex + 1;
  if (next < broadcastQueue.length) return next;
  if (playbackState.loopQueue && broadcastQueue.length > 0) return 0;
  return null;
}

// ─── Server-side snippet auto-advance ────────────────────────────────────────
// When the admin tab is in the background, browsers throttle its JS timers.
// The server independently advances snippets every SNIPPET_ADVANCE_MS seconds
// so the broadcast continues without the admin tab being active.
// When the admin signals an advance (via PATCH /queue/snippet), the server
// resets its timer so voice-driven pacing takes priority when admin is open.

const SNIPPET_ADVANCE_MS = 15_000; // 15 s fallback — admin/voice normally drives at ~12 s
let snippetTimer: ReturnType<typeof setTimeout> | null = null;
let snippetScheduledForArticleId: number | null = null;
let snippetTotalCount: number | null = null;

function clearSnippetTimer() {
  if (snippetTimer !== null) {
    clearTimeout(snippetTimer);
    snippetTimer = null;
  }
}

// Pick a random snippet image URL from the given article (for server-driven interludes).
async function pickServerInterludeImage(articleId: number): Promise<string | null> {
  try {
    const rows = await db
      .select({ id: snippetsTable.id })
      .from(snippetsTable)
      .where(and(eq(snippetsTable.articleId, articleId), isNotNull(snippetsTable.imageUrl)));
    if (rows.length === 0) return null;
    const pick = rows[Math.floor(Math.random() * rows.length)];
    return `/api/snippets/${pick.id}/image`;
  } catch {
    return null;
  }
}

// Called when the server-side timer fires on the LAST snippet of an article.
// Mirrors what the admin does: either start an interlude (if an image is available)
// or advance the queue directly.
async function serverAdvanceQueue() {
  if (!playbackState.autoplayQueue) return;

  const currentArticleId = playbackState.articleId;
  const next = resolveNextIndex(playbackState.queueIndex);
  if (next === null) {
    // No next item and no loop — stop the broadcast.
    playbackState = {
      ...playbackState,
      itemType: null, articleId: null, videoId: null,
      interludeImageUrl: null,
      snippetIndex: 0, queueIndex: -1, onAir: false,
      updatedAt: Date.now(),
    };
    return;
  }

  // Try to show an interlude still before advancing.
  const imageUrl = currentArticleId ? await pickServerInterludeImage(currentArticleId) : null;
  if (imageUrl) {
    clearSnippetTimer();
    playbackState = {
      ...playbackState,
      itemType: 'interlude',
      interludeImageUrl: imageUrl,
      articleId: null,
      videoId: null,
      snippetIndex: 0,
      onAir: true,
      updatedAt: Date.now(),
    };
    scheduleInterludeAdvance();
  } else {
    applyQueueItemAtIndex(next);
  }
}

function scheduleNextSnippetAdvance() {
  clearSnippetTimer();
  const articleId = snippetScheduledForArticleId;
  const total = snippetTotalCount;
  if (!articleId || !total || total <= 0) return;

  const fromIndex = playbackState.snippetIndex;

  snippetTimer = setTimeout(() => {
    snippetTimer = null;
    // Guard: only act if we're still on the same article and on-air
    if (playbackState.articleId !== articleId || !playbackState.onAir) return;

    if (playbackState.snippetIndex !== fromIndex) {
      // Admin already advanced this snippet — just reschedule from new position
      scheduleNextSnippetAdvance();
      return;
    }

    const nextIndex = fromIndex + 1;
    if (nextIndex < total) {
      playbackState = { ...playbackState, snippetIndex: nextIndex, updatedAt: Date.now() };
      scheduleNextSnippetAdvance();
    } else {
      // Article finished — advance the queue server-side if autoplay is on.
      // This keeps the broadcast running even when the admin tab is sleeping.
      void serverAdvanceQueue();
    }
  }, SNIPPET_ADVANCE_MS);
}

async function startSnippetSchedule(articleId: number) {
  clearSnippetTimer();
  snippetScheduledForArticleId = articleId;
  snippetTotalCount = null;

  try {
    const rows = await db
      .select({ id: snippetsTable.id })
      .from(snippetsTable)
      .where(eq(snippetsTable.articleId, articleId));
    snippetTotalCount = rows.length;
  } catch {
    snippetTotalCount = null;
  }

  // Only schedule if we're still on the same article
  if (
    playbackState.articleId === articleId &&
    playbackState.onAir &&
    snippetTotalCount &&
    snippetTotalCount > 0
  ) {
    scheduleNextSnippetAdvance();
  }
}

// ─── Apply queue item ─────────────────────────────────────────────────────────

export function applyQueueItemAtIndex(index: number): void {
  if (index < 0 || index >= broadcastQueue.length) {
    clearSnippetTimer();
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
    if (item.articleId) {
      void startSnippetSchedule(item.articleId);
    }
  } else {
    clearSnippetTimer();
    playbackState = {
      ...playbackState,
      itemType: 'video', videoId: item.videoId ?? null,
      articleId: null, snippetIndex: 0,
      queueIndex: index, onAir: true, updatedAt: Date.now(),
    };
  }
}

// ─── Interlude scheduler ──────────────────────────────────────────────────────

function scheduleInterludeAdvance() {
  clearInterludeTimer();
  interludeTimer = setTimeout(() => {
    interludeTimer = null;
    if (playbackState.autoplayQueue) {
      const next = resolveNextIndex(playbackState.queueIndex);
      if (next !== null) {
        applyQueueItemAtIndex(next);
        return;
      }
    }
    playbackState = {
      ...playbackState,
      itemType: null, articleId: null, videoId: null,
      interludeImageUrl: null,
      snippetIndex: 0, queueIndex: -1, onAir: false,
      updatedAt: Date.now(),
    };
  }, INTERLUDE_DURATION_MS);
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
    snippetIndex: playbackState.snippetIndex,
    autoplayQueue: playbackState.autoplayQueue,
    loopQueue: playbackState.loopQueue,
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
  clearInterludeTimer();
  clearSnippetTimer();
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

// Pause — keeps queue position/article intact, just turns off onAir and kills the timer
router.post("/queue/pause", (_req, res) => {
  clearInterludeTimer();
  clearSnippetTimer();
  playbackState = { ...playbackState, onAir: false, updatedAt: Date.now() };
  res.json(playbackState);
});

// Set an interlude (still image) between queue items — server auto-advances after 30s
router.post("/queue/interlude", (req, res) => {
  const { imageUrl } = req.body ?? {};
  if (typeof imageUrl !== 'string' || !imageUrl.trim()) {
    res.status(400).json({ error: "imageUrl required" }); return;
  }
  clearSnippetTimer();
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
  scheduleInterludeAdvance();
  res.json(playbackState);
});

router.post("/queue/advance", (_req, res) => {
  clearInterludeTimer();
  clearSnippetTimer();
  if (playbackState.autoplayQueue) {
    const next = resolveNextIndex(playbackState.queueIndex);
    if (next !== null) {
      applyQueueItemAtIndex(next);
      res.json(playbackState);
      return;
    }
  }
  playbackState = {
    ...playbackState,
    itemType: null, articleId: null, videoId: null,
    interludeImageUrl: null,
    snippetIndex: 0, queueIndex: -1, onAir: false,
    updatedAt: Date.now(),
  };
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

router.patch("/queue/loop", (req, res) => {
  const { loopQueue } = req.body ?? {};
  if (typeof loopQueue !== 'boolean') {
    res.status(400).json({ error: "loopQueue must be a boolean" }); return;
  }
  playbackState = { ...playbackState, loopQueue, updatedAt: Date.now() };
  res.json(playbackState);
});

router.patch("/queue/snippet", (req, res) => {
  const { snippetIndex } = req.body ?? {};
  if (typeof snippetIndex !== 'number' || snippetIndex < 0) {
    res.status(400).json({ error: "snippetIndex must be >= 0" }); return;
  }
  playbackState = { ...playbackState, snippetIndex, updatedAt: Date.now() };
  // Admin signalled an advance — reset the server-side timer from this new position
  scheduleNextSnippetAdvance();
  res.json(playbackState);
});

export default router;
