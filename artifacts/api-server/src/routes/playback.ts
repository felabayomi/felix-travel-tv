import { Router, type IRouter } from "express";
import { db, snippetsTable, configStore } from "@workspace/db";
import { eq, isNotNull, and, inArray } from "drizzle-orm";

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

// ─── DB persistence ───────────────────────────────────────────────────────────
// Saves the broadcast queue and playback state to the DB so they survive server
// restarts and production deploys. Interlude state is intentionally NOT
// persisted — on restart we resume at the start of the current article.

const QUEUE_DB_KEY = 'broadcast_queue';
const STATE_DB_KEY = 'playback_state';

function persistState(): void {
  const stateToSave = {
    // If in an interlude, record the queue position only — timer will resume next article
    itemType: playbackState.itemType === 'interlude' ? null : playbackState.itemType,
    articleId: playbackState.itemType === 'interlude' ? null : playbackState.articleId,
    videoId: playbackState.itemType === 'interlude' ? null : playbackState.videoId,
    snippetIndex: playbackState.itemType === 'interlude' ? 0 : playbackState.snippetIndex,
    queueIndex: playbackState.queueIndex,
    onAir: playbackState.onAir && playbackState.itemType !== 'interlude',
    autoplayQueue: playbackState.autoplayQueue,
    loopQueue: playbackState.loopQueue,
  };
  const upsert = (key: string, value: string) =>
    db.insert(configStore).values({ key, value })
      .onConflictDoUpdate({ target: configStore.key, set: { value } })
      .catch((e: unknown) => console.error('[persistState] DB error:', e));
  upsert(QUEUE_DB_KEY, JSON.stringify(broadcastQueue));
  upsert(STATE_DB_KEY, JSON.stringify(stateToSave));
}

async function loadPersistedState(): Promise<void> {
  try {
    const rows = await db.select().from(configStore)
      .where(inArray(configStore.key, [QUEUE_DB_KEY, STATE_DB_KEY]));
    const byKey: Record<string, unknown> = {};
    for (const r of rows) {
      try { byKey[r.key] = JSON.parse(r.value); } catch { /* ignore bad JSON */ }
    }

    if (Array.isArray(byKey[QUEUE_DB_KEY])) {
      broadcastQueue.splice(0, broadcastQueue.length, ...(byKey[QUEUE_DB_KEY] as QueueItem[]));
    }

    const s = byKey[STATE_DB_KEY] as Partial<PlaybackState> | undefined;
    if (s) {
      playbackState = {
        ...playbackState,
        itemType: (s.itemType as PlaybackState['itemType']) ?? null,
        articleId: s.articleId ?? null,
        videoId: s.videoId ?? null,
        snippetIndex: s.snippetIndex ?? 0,
        queueIndex: s.queueIndex ?? -1,
        onAir: s.onAir ?? false,
        autoplayQueue: s.autoplayQueue ?? false,
        loopQueue: s.loopQueue ?? false,
        updatedAt: Date.now(),
      };
      // Resume the server-side snippet timer if we were mid-article
      if (playbackState.onAir && playbackState.itemType === 'article' && playbackState.articleId) {
        void startSnippetSchedule(playbackState.articleId);
      }
    }
  } catch (e) {
    console.error('[loadPersistedState] error:', e);
  }
}

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
// The server independently advances snippets so the broadcast continues without
// the admin tab being active.
//
// The server checks every SNIPPET_CHECK_INTERVAL_MS (5 s) whether to advance.
// It uses one of two thresholds:
//   • Admin PRESENT  (last PATCH < 35 s ago): 5-minute safety net — voice drives pacing
//   • Admin ABSENT   (last PATCH ≥ 35 s ago): 15 s fast fallback for overnight looping
//
// This prevents the server from cutting off voice reading mid-sentence while
// still keeping the broadcast alive when the admin tab is backgrounded or closed.

const SNIPPET_ADVANCE_ABSENT_MS  = 15_000;  // fast advance when admin is gone
const SNIPPET_SAFETY_NET_MS      = 300_000; // absolute last resort when admin is present
const ADMIN_PRESENCE_TIMEOUT_MS  = 35_000;  // no PATCH in 35 s → admin considered absent
const SNIPPET_CHECK_INTERVAL_MS  = 5_000;   // how often to re-evaluate

// Timestamp of the last PATCH /queue/snippet call from the admin
let lastAdminSnippetPatch = 0;

// Using setInterval so we can re-evaluate admin presence on every tick
let snippetTimer: ReturnType<typeof setInterval> | null = null;
let snippetScheduledForArticleId: number | null = null;
let snippetTotalCount: number | null = null;

function clearSnippetTimer() {
  if (snippetTimer !== null) {
    clearInterval(snippetTimer);
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
    persistState();
    return;
  }

  // Always show an interlude between articles, using a snippet image if available
  // or an empty background if none are ready yet.
  const imageUrl = currentArticleId ? await pickServerInterludeImage(currentArticleId) : null;
  clearSnippetTimer();
  playbackState = {
    ...playbackState,
    itemType: 'interlude',
    interludeImageUrl: imageUrl ?? '',
    articleId: null,
    videoId: null,
    snippetIndex: 0,
    onAir: true,
    updatedAt: Date.now(),
  };
  persistState();
  scheduleInterludeAdvance();
}

function scheduleNextSnippetAdvance() {
  clearSnippetTimer();
  const articleId = snippetScheduledForArticleId;
  const total = snippetTotalCount;
  if (!articleId || !total || total <= 0) return;

  const fromIndex = playbackState.snippetIndex;
  const startedAt = Date.now();

  snippetTimer = setInterval(() => {
    // Guard: article changed or broadcast stopped
    if (playbackState.articleId !== articleId || !playbackState.onAir) {
      clearSnippetTimer();
      return;
    }

    // Admin already advanced this snippet — sync to new position
    if (playbackState.snippetIndex !== fromIndex) {
      clearSnippetTimer();
      scheduleNextSnippetAdvance();
      return;
    }

    const elapsed = Date.now() - startedAt;
    // Use a long safety-net when the admin is actively present; fast fallback when absent
    const adminIsPresent = Date.now() - lastAdminSnippetPatch < ADMIN_PRESENCE_TIMEOUT_MS;
    const threshold = adminIsPresent ? SNIPPET_SAFETY_NET_MS : SNIPPET_ADVANCE_ABSENT_MS;

    if (elapsed >= threshold) {
      clearSnippetTimer();
      const nextIndex = fromIndex + 1;
      if (nextIndex < total) {
        // Advance to next snippet
        playbackState = { ...playbackState, snippetIndex: nextIndex, updatedAt: Date.now() };
        scheduleNextSnippetAdvance();
      } else {
        // Article finished — advance the queue server-side if autoplay is on.
        // This keeps the broadcast running when the admin tab is backgrounded or closed.
        void serverAdvanceQueue();
      }
    }
  }, SNIPPET_CHECK_INTERVAL_MS);
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
    persistState();
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
    persistState();
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
    persistState();
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
    persistState();
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
  persistState();
  res.json(playbackState);
});

router.patch("/", (req, res) => {
  const { onAir } = req.body ?? {};
  if (typeof onAir !== "boolean") {
    res.status(400).json({ error: "onAir must be a boolean" });
    return;
  }
  playbackState = { ...playbackState, onAir, updatedAt: Date.now() };
  persistState();
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
  persistState();
  res.json({ items: broadcastQueue });
});

router.post("/queue/item", (req, res) => {
  const { type, articleId, videoId, title } = req.body ?? {};
  if ((type !== 'article' && type !== 'video') || typeof title !== 'string') {
    res.status(400).json({ error: "type and title required" }); return;
  }
  broadcastQueue.push({ type, articleId: articleId ?? null, videoId: videoId ?? null, title });
  persistState();
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
  persistState();
  res.json({ items: broadcastQueue });
});

router.post("/queue/play/:index", (req, res) => {
  const idx = parseInt(req.params.index, 10);
  applyQueueItemAtIndex(idx);  // applyQueueItemAtIndex calls persistState() internally
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
  persistState();
  res.json(playbackState);
});

// Pause — keeps queue position/article intact, just turns off onAir and kills the timer
router.post("/queue/pause", (_req, res) => {
  clearInterludeTimer();
  clearSnippetTimer();
  playbackState = { ...playbackState, onAir: false, updatedAt: Date.now() };
  persistState();
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
  // Interlude is ephemeral — we don't persist it; persistState() writes onAir=false
  // which means on restart we safely skip the interlude and resume at the next article
  persistState();
  scheduleInterludeAdvance();
  res.json(playbackState);
});

router.post("/queue/advance", (_req, res) => {
  clearInterludeTimer();
  clearSnippetTimer();
  if (playbackState.autoplayQueue) {
    const next = resolveNextIndex(playbackState.queueIndex);
    if (next !== null) {
      applyQueueItemAtIndex(next);  // applyQueueItemAtIndex calls persistState() internally
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
  persistState();
  res.json(playbackState);
});

router.patch("/queue/autoplay", (req, res) => {
  const { autoplayQueue } = req.body ?? {};
  if (typeof autoplayQueue !== 'boolean') {
    res.status(400).json({ error: "autoplayQueue must be a boolean" }); return;
  }
  playbackState = { ...playbackState, autoplayQueue, updatedAt: Date.now() };
  persistState();
  res.json(playbackState);
});

router.patch("/queue/loop", (req, res) => {
  const { loopQueue } = req.body ?? {};
  if (typeof loopQueue !== 'boolean') {
    res.status(400).json({ error: "loopQueue must be a boolean" }); return;
  }
  playbackState = { ...playbackState, loopQueue, updatedAt: Date.now() };
  persistState();
  res.json(playbackState);
});

router.patch("/queue/snippet", (req, res) => {
  const { snippetIndex } = req.body ?? {};
  if (typeof snippetIndex !== 'number' || snippetIndex < 0) {
    res.status(400).json({ error: "snippetIndex must be >= 0" }); return;
  }
  // Record that the admin is present — prevents server fallback from firing mid-voice
  lastAdminSnippetPatch = Date.now();
  playbackState = { ...playbackState, snippetIndex, updatedAt: Date.now() };
  persistState();
  // Reset the server-side timer from this new position
  scheduleNextSnippetAdvance();
  res.json(playbackState);
});

// Load persisted queue and state from DB on startup so production restarts
// don't lose the broadcast queue and current playback position.
void loadPersistedState();

export default router;
