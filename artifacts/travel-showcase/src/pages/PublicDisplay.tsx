import { useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useGetArticles, useGetArticleSnippets } from '@workspace/api-client-react';
import { ProgressBar } from '@/components/ProgressBar';
import { SnippetDisplay } from '@/components/SnippetDisplay';
import { AmbientMusicPlayer } from '@/components/AmbientMusicPlayer';

function ESTClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const day = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }).toUpperCase();
  const date = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).toUpperCase();
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true, timeZone: 'America/New_York' });

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: '11px', fontWeight: 400, letterSpacing: '0.18em', color: 'rgba(255,255,255,0.4)' }}>
        {day} · EST
      </span>
      <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: '11px', fontWeight: 400, letterSpacing: '0.12em', color: 'rgba(255,255,255,0.55)' }}>
        {date}
      </span>
      <span style={{ fontFamily: 'Oswald, sans-serif', fontSize: '22px', fontWeight: 600, letterSpacing: '0.06em', color: '#ffffff', lineHeight: 1.2 }}>
        {time}
      </span>
    </div>
  );
}

interface PlaybackState {
  articleId: number | null;
  snippetIndex: number;
  onAir: boolean;
  updatedAt: number;
}

interface TickerItem {
  headline: string;
  caption: string;
  isCustom?: boolean;
}

interface WaitingConfig {
  channelName: string;
  tagline: string;
  broadcastTime: string | null;
  topics: string[];
  websiteLabel: string;
  websiteUrl: string;
  socialLinks: Array<{ label: string; url: string }>;
  customTickerItems: string[];
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

function useWaitingConfig() {
  const [config, setConfig] = useState<WaitingConfig | null>(null);

  useEffect(() => {
    async function fetchConfig() {
      try {
        const res = await fetch('/api/waiting-config');
        if (res.ok) setConfig(await res.json());
      } catch { /* ignore */ }
    }
    fetchConfig();
    const id = setInterval(fetchConfig, 10000);
    return () => clearInterval(id);
  }, []);

  return config;
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

function Countdown({ targetTime }: { targetTime: string }) {
  const [remaining, setRemaining] = useState(() => {
    const diff = new Date(targetTime).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 1000));
  });

  useEffect(() => {
    const id = setInterval(() => {
      const diff = new Date(targetTime).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(diff / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [targetTime]);

  if (remaining <= 0) {
    return (
      <p
        className="text-white/40 text-sm uppercase tracking-widest"
        style={{ fontFamily: 'Oswald, sans-serif' }}
      >
        Broadcast starting shortly
      </p>
    );
  }

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const timeStr = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;

  return (
    <div>
      <p
        className="text-white/30 text-xs uppercase tracking-widest mb-1"
        style={{ fontFamily: 'Oswald, sans-serif' }}
      >
        Broadcast begins in
      </p>
      <p
        className="text-5xl text-white tabular-nums"
        style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, letterSpacing: '0.05em' }}
      >
        {timeStr}
      </p>
    </div>
  );
}

function GlobalTicker() {
  const [items, setItems] = useState<TickerItem[]>([]);

  useEffect(() => {
    async function fetchTicker() {
      try {
        const res = await fetch('/api/ticker', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setItems(data);
        }
      } catch { /* ignore */ }
    }
    fetchTicker();
    const id = setInterval(fetchTicker, 10000);
    return () => clearInterval(id);
  }, []);

  const tickerText = items.length > 0
    ? items.map(item =>
        item.isCustom || !item.caption
          ? item.headline.toUpperCase()
          : `${item.headline.toUpperCase()}  ·  ${item.caption}`
      ).join('     ◆     ')
    : 'STANDING BY FOR BROADCAST  ·  TUNE IN FOR LIVE COVERAGE';

  const duration = Math.max(8, Math.round(tickerText.length * 0.017));

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
  const config = useWaitingConfig();
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

  if (!articleId || !onAir) {
    const channelName = config?.channelName || 'News Reader';
    const tagline = config?.tagline || '';
    const hasTopics = (config?.topics?.length ?? 0) > 0;
    const hasWebsite = !!config?.websiteUrl;
    const hasSocial = (config?.socialLinks?.length ?? 0) > 0;
    const hasCountdown = !!config?.broadcastTime;
    const hasInfo = hasTopics || hasWebsite || hasSocial;

    return (
      <div
        className="min-h-screen relative overflow-hidden flex flex-col items-center justify-center p-12 pb-28"
        style={{ background: '#050508' }}
      >
        {/* Top accent line */}
        <div
          className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: 'linear-gradient(to right, #c8102e, #ff3333, #c8102e)' }}
        />

        {/* Top-right: ON AIR badge + EST clock */}
        <div className="absolute top-4 right-6 flex flex-col items-end gap-3">
          <AnimatePresence>
            {onAir && (
              <motion.div
                key="on-air-wait"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-sm"
                style={{ background: '#c8102e' }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span style={{ fontFamily: 'Oswald, sans-serif', color: '#fff', fontWeight: 700, fontSize: '12px', letterSpacing: '0.1em' }}>
                  ON AIR
                </span>
              </motion.div>
            )}
          </AnimatePresence>
          <ESTClock />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="w-full max-w-4xl"
        >
          {/* Two-column layout when there are topics */}
          <div className={`flex gap-16 ${hasTopics ? 'items-start' : 'flex-col items-center text-center'}`}>

            {/* Left / Center: Branding + countdown + website/social */}
            <div className={`flex flex-col gap-7 flex-1 ${hasTopics ? 'items-start' : 'items-center'}`}>

              {/* Thin red rule */}
              <div
                className={`h-px w-16 ${hasTopics ? '' : 'mx-auto'}`}
                style={{ background: '#c8102e' }}
              />

              {/* Channel name */}
              <div>
                <h1
                  className="text-6xl text-white uppercase"
                  style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, letterSpacing: '0.06em', lineHeight: 1 }}
                >
                  {channelName}
                </h1>
                {tagline && (
                  <p
                    className="text-white/35 text-sm uppercase tracking-widest mt-2"
                    style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}
                  >
                    {tagline}
                  </p>
                )}
              </div>

              {/* Countdown */}
              {hasCountdown && config?.broadcastTime && (
                <Countdown targetTime={config.broadcastTime} />
              )}

              {/* Standby text when no countdown */}
              {!hasCountdown && (
                <p
                  className="text-white/25 text-base tracking-wide"
                  style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}
                >
                  Live broadcast starting soon
                </p>
              )}

              {/* Website */}
              {hasWebsite && (
                <div className={hasTopics ? '' : 'text-center'}>
                  {config?.websiteLabel && (
                    <p
                      className="text-white/55 text-[11px] uppercase tracking-widest mb-1"
                      style={{ fontFamily: 'Oswald, sans-serif' }}
                    >
                      {config.websiteLabel}
                    </p>
                  )}
                  <p
                    className="text-white/90 font-mono text-sm"
                    style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}
                  >
                    {config?.websiteUrl}
                  </p>
                </div>
              )}

              {/* Social links */}
              {hasSocial && (
                <div className={`space-y-1.5 ${hasTopics ? '' : 'text-center'}`}>
                  {config?.socialLinks.map((link, i) => (
                    <p key={i} className="text-white/75 text-xs" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
                      <span className="text-white/50 mr-1">{link.label}:</span>
                      {link.url}
                    </p>
                  ))}
                </div>
              )}

              {/* Thin rule bottom */}
              <div
                className={`h-px w-16 ${hasTopics ? '' : 'mx-auto'}`}
                style={{ background: 'rgba(200,16,46,0.3)' }}
              />
            </div>

            {/* Right: Today's Topics */}
            {hasTopics && (
              <div className="shrink-0 w-64 pt-1">
                <p
                  className="text-[#c8102e] text-xs uppercase tracking-widest font-bold mb-4"
                  style={{ fontFamily: 'Oswald, sans-serif', letterSpacing: '0.18em' }}
                >
                  Today's Topics
                </p>
                <ul className="space-y-3">
                  {config?.topics.map((topic, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-3 text-white/60 text-sm"
                      style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: '#c8102e' }}
                      />
                      {topic}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
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
