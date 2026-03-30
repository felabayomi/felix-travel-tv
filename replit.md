# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## PROTECTED SYSTEMS — DO NOT MODIFY WITHOUT READING THIS FIRST

The following three systems work together as a single tightly-coupled broadcast engine. They have been carefully debugged and must not be changed, refactored, or "cleaned up" as part of any unrelated feature work. Any change to one part can silently break the others.

### 1. Server-side snippet advance + queue advance (`artifacts/api-server/src/routes/playback.ts`)

Key invariants that MUST be preserved:
- `clearSnippetTimer()` is called at the **very start** of `serverAdvanceQueue()`, BEFORE any `await`. If moved after the await, the interval fires again during the async image fetch and calls `serverAdvanceQueue()` multiple times, causing double-advances and broken loops.
- `scheduleInterludeAdvance()` always fires after every article finishes (server side), regardless of whether an image was found. The interlude always shows for `INTERLUDE_DURATION_MS` (30 s) before advancing.
- `itemType` is included in the `GET /queue` response so the admin page can detect interlude state.
- Constants: `SNIPPET_ADVANCE_ABSENT_MS=15000`, `SNIPPET_SAFETY_NET_MS=300000`, `ADMIN_PRESENCE_TIMEOUT_MS=35000`, `SNIPPET_CHECK_INTERVAL_MS=5000`, `INTERLUDE_DURATION_MS=30000`.

### 2. Admin advance + voice + auto-advance timer (`artifacts/travel-showcase/src/pages/AdminPage.tsx`)

Key invariants that MUST be preserved:
- `advance()` checks `serverItemTypeRef.current === 'interlude'` at the very top and returns immediately if true. This prevents the admin from double-firing during the server's 30 s interlude countdown.
- `advance()` always posts to `/api/playback/queue/interlude` (with `imageUrl: imageUrl ?? ''`) when there is a next item — it never calls `apiAdvanceQueue()` directly to skip the interlude.
- The auto-advance timer `useEffect` checks `serverItemType === 'interlude'` and returns early — the timer must not fire during interlude.
- `serverItemType` is synced from `GET /queue` on every `loadQueue()` poll (every 2 s). The `serverItemTypeRef` keeps it always-current for async callbacks.
- The voice effect (`speakRef.current(...)`) attaches `onEnded` that calls `advanceRef.current()`. `queueAutoplay` is accessed via `queueAutoplayRef` — NOT as a dep — so toggling autoplay never restarts the audio.
- `snippetIndex` is intentionally NOT synced from the server in `loadQueue`. The admin drives all snippet advances. Syncing it caused race conditions that truncated voice mid-read.

### 3. TTS audio endpoint (`artifacts/api-server/src/routes/index.ts`)
- **MUST use Google Translate TTS** — NOT OpenAI TTS (not supported by Replit AI proxy), NOT Web Speech API
- Endpoint: `GET /api/snippets/:id/audio` → returns MP3 audio
- Text is split into ≤185-char chunks (sentence boundaries first, then word boundaries) and fetched sequentially from Google TTS
- All chunks are concatenated into one Buffer and cached in-memory (`ttsCache: Map<number, Buffer>`) per server run
- The concatenated MP3 premature-ended issue was a red herring — the real cause of truncation was the server timer advancing chapters at 35s (now fixed separately)
- **DO NOT switch to OpenAI TTS** — `POST /audio/speech` returns 400 from the Replit AI integration proxy every time; this causes the 2s error fallback to fire on every chapter, making it skip instantly

### Server-side snippet timer — admin presence logic (DO NOT regress this)
- `ADMIN_PRESENCE_TIMEOUT_MS = 120_000` (2 min) — admin considered absent after 2 min without any PATCH
- `SNIPPET_ADVANCE_ABSENT_MS = 15_000` — advance 15 s **after admin BECOMES absent**, NOT 15 s after the snippet started
- The timer tracks `adminBecameAbsentAt` — only starts counting the 15 s when admin first goes absent
- **Critical bug that was fixed**: the old code checked `elapsed >= threshold` where `elapsed` was measured from snippet start. Since a 35-second chapter exceeded the 15 s threshold before the 35 s presence timeout even expired, the server advanced mid-sentence the instant the admin was considered absent. Now it correctly waits 15 s of actual absence.
- `PATCH /api/playback/presence` — lightweight heartbeat endpoint that refreshes `lastAdminSnippetPatch` without resetting the snippet timer
- Admin sends this heartbeat every 20 s while voice is enabled, ensuring the server never treats an actively-reading admin as absent

### 4. Voice reader hook (`artifacts/travel-showcase/src/hooks/use-voice-reader.ts`)

Key invariants that MUST be preserved:
- `genRef` (generation counter) prevents stale async callbacks: every `speak()` call increments the generation; after the fetch completes it checks `genRef.current !== myGen` and discards the result if a newer call has taken over.
- `stop()` clears `onended` and `ontimeupdate` before pausing, so no stale callback fires after stopping.
- Audio fetch failures fall through to call `onEnded` after 2 s so the slideshow never freezes on a TTS error.

### Server restart / deployment presence grace period (DO NOT regress)
- On server boot, `loadPersistedState()` sets `lastAdminSnippetPatch = Date.now()` **before** calling `startSnippetSchedule()`.
- This gives the admin a full `ADMIN_PRESENCE_TIMEOUT_MS` (120 s) window to reconnect after a deployment before the server ever considers them absent.
- **Bug that was fixed**: without this, every new deployment caused `lastAdminSnippetPatch = 0`, making the server instantly treat the admin as absent and auto-advance snippets every 15 s.

### playingArticleId nulled during interlude (DO NOT regress)
- `playingArticleId` is derived as `null` whenever `serverItemType === 'interlude'`, even though `queue[queueIndex].articleId` is still the same article.
- **Why**: when a single-article looping queue completes and loops back, the same `articleId` is reused. Without nulling it during interlude, the `useEffect([playingArticleId])` reset never fires (articleId didn't change), leaving `currentSnippetIndex` at the last chapter and `prevIndexRef` stale. Voice never restarts for the looped article.
- **With the null**: articleId goes `75 → null → 75` across the interlude boundary, which fires the effect that resets `currentSnippetIndex = 0` and clears `prevIndexRef`, allowing voice to restart from chapter 1 on loop-back.

### Summary of what breaks when these are touched accidentally:
| Symptom | Cause |
|---|---|
| Same article replays in a loop | `clearSnippetTimer()` moved after await in `serverAdvanceQueue` |
| Interlude is skipped | `advance()` calls `apiAdvanceQueue()` directly when no image found |
| Double-advance cuts articles short | Auto-advance timer fires during interlude (missing `serverItemType` guard) |
| Voice cuts off mid-sentence | `snippetIndex` synced from server in `loadQueue` |
| Audio plays twice or overlaps | `genRef` logic removed or `onended` not cleared in `stop()` |
| Chapters skip wildly after deployment | `lastAdminSnippetPatch` not initialized to `Date.now()` on server boot |
| Single-article loop never restarts voice | `playingArticleId` not nulled during interlude (articleId unchanged across loop) |

---

## Artifacts

### `artifacts/travel-showcase` (`@workspace/travel-showcase`)

Cinematic **News Reader** — "Books & Chapters" concept. Users paste a news article URL → backend fetches full article content → AI (GPT-5.2) breaks the article into 5–10 story snippets (chapters) → AI generates a unique image per chapter → displayed as a full-screen looping slideshow.

**Data model:**
- `articles` table — one per URL (title, summary, source, publishedAt, createdAt)
- `snippets` table — 5–10 per article (headline, caption, explanation, imageUrl, snippetOrder)

**UI:**
- Left sidebar: articles grouped by date (Today / Yesterday / date), click to select
- Main display: full-screen cinematic snippet view with chapter badge, headline, caption, explanation
- Auto-advances through chapters every 12 seconds in a loop
- Chapter dot nav and prev/next arrows for manual navigation
- Admin panel (gear icon × 6): add new article URL (PIN protected)
- Gear icon bottom right (6 quick taps to open), default PIN: 1234 or `VITE_ADMIN_PIN`

**Key files:**
- `src/pages/NewsPage.tsx` — main layout (sidebar + display)
- `src/components/SnippetDisplay.tsx` — full-screen chapter view
- `src/components/ArticleSidebar.tsx` — date-grouped article list
- `src/components/NewsAdminPanel.tsx` — URL submission form
- `src/hooks/use-snippet-player.ts` — auto-advance logic for chapters

Depends on: `@workspace/api-client-react`, `@workspace/integrations-openai-ai-react`

### `lib/integrations-openai-ai-server` (`@workspace/integrations-openai-ai-server`)

OpenAI integration server package. Provides the OpenAI client, image generation, audio utilities, and batch processing.

### `lib/integrations-openai-ai-react` (`@workspace/integrations-openai-ai-react`)

OpenAI integration React package. Provides voice chat hooks.

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers; `src/routes/health.ts` exposes `GET /health` (full path: `/api/health`)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas (no models definitions exist right now)
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`, automatically provided by Replit)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Production migrations are handled by Replit when publishing. In development, we just use `pnpm --filter @workspace/db run push`, and we fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.
