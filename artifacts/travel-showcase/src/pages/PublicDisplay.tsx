import { useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Newspaper } from 'lucide-react';
import { useGetArticles, useGetArticleSnippets } from '@workspace/api-client-react';
import { ProgressBar } from '@/components/ProgressBar';
import { SnippetDisplay } from '@/components/SnippetDisplay';
import { AmbientMusicPlayer } from '@/components/AmbientMusicPlayer';

interface PlaybackState {
  articleId: number | null;
  snippetIndex: number;
  onAir: boolean;
  updatedAt: number;
}

interface TickerItem {
  headline: string;
  caption: string;
}

const POLL_MS = 2000;

function usePlaybackSync() {
  const [state, setState] = useState<PlaybackState>({ articleId: null, snippetIndex: 0, onAir: false, updatedAt: 0 });

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch('/api/playback');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setState(prev => data.updatedAt !== prev.updatedAt ? data : prev);
        }
      } catch { /* network error — keep last state */ }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return state;
}

function LiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span
      className="tabular-nums tracking-wider text-white/55 text-sm"
      style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500 }}
    >
      {time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
    </span>
  );
}

function GlobalTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    async function fetchTicker() {
      try {
        const res = await fetch('/api/ticker');
        if (res.ok) {
          const data = await res.json();
          setItems(data);
        }
      } catch { /* ignore */ }
    }
    fetchTicker();
    const id = setInterval(fetchTicker, 30000);
    return () => clearInterval(id);
  }, []);

  const tickerText = items.length > 0
    ? items.map(item => `${item.headline.toUpperCase()}  ·  ${item.caption}`).join('     ◆     ')
    : 'STANDING BY FOR BROADCAST  ·  TUNE IN FOR LIVE COVERAGE';

  // Scale duration with content length so scroll speed stays ~180px/s
  const duration = Math.max(8, Math.round(tickerText.length * 0.02));

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-50 flex items-center overflow-hidden"
      style={{ height: '80px', background: 'rgba(3,3,8,0.97)', borderTop: '2px solid #c8102e' }}
    >
      {/* Logo + label */}
      <div
        className="flex-shrink-0 flex items-center gap-3 h-full px-6"
        style={{ background: '#ffffff' }}
      >
        <img
          src="/ticker-logo.png"
          alt="logo"
          style={{ height: '58px', width: 'auto', objectFit: 'contain', display: 'block' }}
        />
        <span style={{ fontFamily: 'Oswald, sans-serif', color: '#111', fontWeight: 700, fontSize: '15px', letterSpacing: '0.1em' }}>
          NEWS
        </span>
      </div>

      {/* Seamless double-copy scroll */}
      <div className="flex-1 overflow-hidden">
        <div
          className="flex whitespace-nowrap"
          style={{ animation: `global-ticker-scroll ${duration}s linear infinite` }}
        >
          <span style={{ paddingRight: '5rem', fontFamily: 'IBM Plex Sans, sans-serif', fontWeight: 500, fontSize: '19px', color: 'rgba(255,255,255,0.85)', letterSpacing: '0.05em' }}>
            {tickerText}
          </span>
          <span style={{ paddingRight: '5rem', fontFamily: 'IBM Plex Sans, sans-serif', fontWeight: 500, fontSize: '19px', color: 'rgba(255,255,255,0.85)', letterSpacing: '0.05em' }}>
            {tickerText}
          </span>
        </div>
      </div>

      <style>{`
        @keyframes global-ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

export function PublicDisplay() {
  const { articleId, snippetIndex, onAir } = usePlaybackSync();
  const { data: articles = [] } = useGetArticles();
  const { data: snippets = [], isLoading: isLoadingSnippets } = useGetArticleSnippets(
    articleId ?? 0,
    { query: { enabled: articleId !== null } }
  );

  const safeIndex = Math.min(snippetIndex, Math.max(0, snippets.length - 1));
  const currentSnippet = snippets[safeIndex] ?? null;
  const selectedArticle = articles.find(a => a.id === articleId) ?? null;

  const [tick, setTick] = useState(0);
  const prevIndexRef = useRef(snippetIndex);
  useEffect(() => {
    if (prevIndexRef.current !== snippetIndex) {
      prevIndexRef.current = snippetIndex;
      setTick(t => t + 1);
    }
  }, [snippetIndex]);

  if (!articleId) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center text-center p-8"
        style={{ background: '#050508' }}
      >
        {/* Top accent line */}
        <div className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: 'linear-gradient(to right, #c8102e, #ff3333, #c8102e)' }} />

        {/* ON AIR badge even on waiting screen */}
        <AnimatePresence>
          {onAir && (
            <motion.div
              key="on-air-wait"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-4 right-6 flex items-center gap-1.5 px-3 py-1 rounded-sm"
              style={{ background: '#c8102e' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              <span style={{ fontFamily: 'Oswald, sans-serif', color: '#fff', fontWeight: 700, fontSize: '12px', letterSpacing: '0.1em' }}>
                ON AIR
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1 }}
          className="flex flex-col items-center"
        >
          <Newspaper className="w-20 h-20 mb-8" style={{ color: '#c8102e', opacity: 0.25 }} />
          <h1
            className="text-5xl mb-4 text-white uppercase tracking-widest"
            style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700 }}
          >
            News Reader
          </h1>
          <p className="text-base text-white/30 leading-relaxed max-w-sm tracking-wide"
            style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
            Waiting for the broadcast to begin...
          </p>
        </motion.div>

        <GlobalTicker />
      </div>
    );
  }

  return (
    <main className="relative w-screen h-screen overflow-hidden" style={{ background: '#050508' }}>

      {/* ── Snippet slideshow ── */}
      {isLoadingSnippets ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin" style={{ color: '#c8102e', opacity: 0.5 }} />
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {snippets.map((snippet, index) => (
            <SnippetDisplay
              key={snippet.id}
              snippet={snippet}
              isActive={index === safeIndex}
              chapterIndex={index}
              totalChapters={snippets.length}
            />
          ))}
        </AnimatePresence>
      )}

      {/* ── Unified top HUD bar (z-40, above everything) ── */}
      <div
        className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-8"
        style={{
          paddingTop: '18px',
          paddingBottom: '18px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.88) 0%, transparent 100%)',
          borderTop: '3px solid #c8102e',
        }}
      >
        {/* Left: source + chapter */}
        <div className="flex items-center gap-3">
          {selectedArticle?.source && (
            <>
              <span
                className="text-white/80 text-xs tracking-[0.18em] uppercase"
                style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 600 }}
              >
                {selectedArticle.source}
              </span>
              <span className="text-white/20 text-xs">·</span>
            </>
          )}
          {snippets.length > 0 && (
            <span
              className="text-white/40 text-xs tracking-[0.15em] uppercase"
              style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500 }}
            >
              Clip {safeIndex + 1} of {snippets.length}
            </span>
          )}
        </div>

        {/* Right: clock + ON AIR badge */}
        <div className="flex items-center gap-3">
          <LiveClock />
          <AnimatePresence>
            {onAir && (
              <motion.div
                key="on-air"
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-1.5 px-3 py-0.5 rounded-sm"
                style={{ background: '#c8102e' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span
                  style={{ fontFamily: 'Oswald, sans-serif', color: '#fff', fontWeight: 700, fontSize: '12px', letterSpacing: '0.12em' }}
                >
                  ON AIR
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Progress bar ── */}
      {currentSnippet && (
        <ProgressBar
          duration={20000}
          slideKey={`public-${currentSnippet.id}-${tick}`}
          isPaused={false}
        />
      )}

      {/* ── Global persistent ticker (always at bottom, never resets on slide change) ── */}
      <GlobalTicker />

      <AmbientMusicPlayer />
    </main>
  );
}
