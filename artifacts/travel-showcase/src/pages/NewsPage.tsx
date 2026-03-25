import { useState, useEffect, useCallback, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Loader2, Newspaper, ChevronLeft, ChevronRight, LayoutList, X,
  SlidersHorizontal, Mic, MicOff, Timer
} from 'lucide-react';
import {
  useGetArticles,
  useGetArticleSnippets,
  useDeleteArticle,
  getGetArticlesQueryKey,
} from '@workspace/api-client-react';
import type { Article, Snippet } from '@workspace/api-client-react/src/generated/api.schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useSnippetPlayer } from '@/hooks/use-snippet-player';
import { useVoiceReader } from '@/hooks/use-voice-reader';
import { SnippetDisplay } from '@/components/SnippetDisplay';
import { ArticleSidebar } from '@/components/ArticleSidebar';
import { ProgressBar } from '@/components/ProgressBar';
import { NewsAdminPanel } from '@/components/NewsAdminPanel';
import { AmbientMusicPlayer } from '@/components/AmbientMusicPlayer';
import { cn } from '@/lib/utils';

const TIMING_OPTIONS = [
  { label: '10s', value: 10000 },
  { label: '15s', value: 15000 },
  { label: '20s', value: 20000 },
  { label: '30s', value: 30000 },
  { label: '45s', value: 45000 },
  { label: '60s', value: 60000 },
];

// ~138 words per minute at speech rate 0.92 → 2.3 words/sec
const WORDS_PER_SEC = 2.3;

function computeReadingMs(snippet: Snippet | null): number {
  if (!snippet) return 15000;
  const text = [snippet.headline, snippet.caption, snippet.explanation]
    .filter(Boolean).join('. ');
  const words = text.trim().split(/\s+/).length;
  const ms = Math.round((words / WORDS_PER_SEC) * 1000) + 1200; // +1.2s buffer
  return Math.max(8000, Math.min(120000, ms)); // clamp 8s–120s
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function NewsPage() {
  const queryClient = useQueryClient();
  const { data: articles = [], isLoading, isError } = useGetArticles();

  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [intervalMs, setIntervalMs] = useState(10000);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [totalSeconds, setTotalSeconds] = useState(0);

  // Auto-select the first article when loaded
  useEffect(() => {
    if (articles.length > 0 && selectedArticleId === null) {
      setSelectedArticleId(articles[0].id);
    }
  }, [articles, selectedArticleId]);

  const { data: snippets = [], isLoading: isLoadingSnippets } = useGetArticleSnippets(
    selectedArticleId ?? 0,
    { query: { enabled: selectedArticleId !== null } }
  );

  // When voice is on: each chapter's timer = its reading duration (word-count based)
  // When voice is off: use the user-selected interval from settings
  // activeInterval is computed from the current snippet so each chapter gets its own timing
  const [currentSnippetForTiming, setCurrentSnippetForTiming] = useState<Snippet | null>(null);
  const activeInterval = voiceEnabled
    ? computeReadingMs(currentSnippetForTiming)
    : intervalMs;

  // When voice is on, pause the timer — slides advance only when audio finishes
  const { currentIndex, currentSnippet, next, prev, goTo } = useSnippetPlayer(snippets, activeInterval, voiceEnabled);

  // Keep the timing snippet in sync (one render behind is fine — applies on next chapter)
  useEffect(() => {
    setCurrentSnippetForTiming(currentSnippet);
  }, [currentSnippet]);

  const selectedArticle = articles.find(a => a.id === selectedArticleId) ?? null;

  const { speak, stop, prefetch, isLoading: isVoiceLoading, playProgress } = useVoiceReader(voiceEnabled);

  // Speak current chapter when it changes; advance slide when audio ends
  const prevSnippetIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!currentSnippet) return;
    if (prevSnippetIdRef.current === currentSnippet.id) return;
    prevSnippetIdRef.current = currentSnippet.id;
    if (voiceEnabled) {
      speak(currentSnippet.id, next);
    }
    // Prefetch the next chapter's audio in the background
    const nextSnippet = snippets[currentIndex + 1];
    if (nextSnippet) prefetch(nextSnippet.id);
  }, [currentSnippet, currentIndex, snippets, voiceEnabled, speak, prefetch, next]);

  // Stop voice + reset when switching articles
  useEffect(() => {
    stop();
    prevSnippetIdRef.current = null;
    setTotalSeconds(0);
  }, [selectedArticleId, stop]);

  // When voice is turned ON mid-chapter, immediately start speaking the current chapter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!voiceEnabled || !currentSnippet) return;
    prevSnippetIdRef.current = currentSnippet.id;
    speak(currentSnippet.id, next);
  }, [voiceEnabled]); // intentionally omit speak/next/currentSnippet to only run when voice flips ON

  // Total time counter — ticks every second while playing
  useEffect(() => {
    if (snippets.length === 0) return;
    const id = setInterval(() => setTotalSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [snippets.length, selectedArticleId]);

  const deleteMutation = useDeleteArticle({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetArticlesQueryKey() });
        setSelectedArticleId(null);
      }
    }
  });

  const handleSelectArticle = useCallback((article: Article) => {
    setSelectedArticleId(article.id);
  }, []);

  const handleDelete = useCallback((id: number) => {
    deleteMutation.mutate({ id });
  }, [deleteMutation]);

  const handleArticleAdded = useCallback(() => {
    setSelectedArticleId(null);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-primary">
        <Loader2 className="w-12 h-12 animate-spin mb-6 opacity-80" />
        <h2 className="font-display text-2xl tracking-widest uppercase">Loading News Feed</h2>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-destructive">
        <div className="text-center">
          <h2 className="font-display text-2xl mb-2">Feed Unavailable</h2>
          <p className="text-muted-foreground">Unable to connect to the news server.</p>
        </div>
      </div>
    );
  }

  const isEmpty = articles.length === 0;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-background">

      {/* Sidebar toggle button */}
      <button
        onClick={() => setSidebarOpen(v => !v)}
        className={cn(
          "absolute top-5 z-30 p-2.5 rounded-full bg-black/30 backdrop-blur-md border border-white/10",
          "text-white/60 hover:text-white hover:bg-black/60 transition-all duration-300",
          sidebarOpen ? "left-[calc(288px+12px)]" : "left-5"
        )}
        title={sidebarOpen ? "Hide sidebar" : "Show articles"}
      >
        {sidebarOpen ? <X className="w-4 h-4" /> : <LayoutList className="w-4 h-4" />}
      </button>

      {/* Article Sidebar */}
      <ArticleSidebar
        articles={articles}
        selectedId={selectedArticleId}
        onSelect={handleSelectArticle}
        onDelete={handleDelete}
        isDeleting={deleteMutation.isPending}
        isOpen={sidebarOpen}
      />

      {/* Main display area */}
      <div
        className={cn(
          "absolute inset-0 transition-all duration-500",
          sidebarOpen ? "left-72" : "left-0"
        )}
      >
        {isEmpty ? (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-background to-background flex flex-col items-center justify-center text-center p-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1 }}
              className="flex flex-col items-center"
            >
              <Newspaper className="w-24 h-24 text-primary/30 mb-8" />
              <h1 className="text-4xl md:text-6xl font-display font-bold text-white mb-4">News Reader</h1>
              <p className="text-xl text-muted-foreground max-w-lg font-light leading-relaxed">
                No articles loaded yet. Open the admin panel (tap the gear icon 6 times) to add your first news URL.
              </p>
            </motion.div>
          </div>
        ) : (
          <>
            {/* Snippet display */}
            {isLoadingSnippets || snippets.length === 0 ? (
              <div className="absolute inset-0 bg-background flex flex-col items-center justify-center gap-4">
                {isLoadingSnippets ? (
                  <>
                    <Loader2 className="w-10 h-10 animate-spin text-primary/60" />
                    <p className="text-muted-foreground text-sm">Loading chapters...</p>
                  </>
                ) : selectedArticle ? (
                  <div className="text-center">
                    <Newspaper className="w-16 h-16 text-primary/20 mx-auto mb-4" />
                    <p className="text-muted-foreground">{selectedArticle.title}</p>
                    <p className="text-xs text-muted-foreground/50 mt-2">No chapters available for this article.</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {snippets.map((snippet, index) => (
                  <SnippetDisplay
                    key={snippet.id}
                    snippet={snippet}
                    isActive={index === currentIndex}
                    chapterIndex={index}
                    totalChapters={snippets.length}
                  />
                ))}
              </AnimatePresence>
            )}

            {/* Navigation & info overlay */}
            {snippets.length > 0 && currentSnippet && (
              <>
                {/* Article title — top left */}
                <div className="absolute top-5 left-5 z-20 max-w-[300px]">
                  <p className="text-xs text-white/40 uppercase tracking-widest mb-0.5">
                    {selectedArticle?.source || 'News'}
                  </p>
                  <p className="text-sm font-medium text-white/70 line-clamp-2 leading-snug">
                    {selectedArticle?.title}
                  </p>
                </div>

                {/* Top right: chapter counter + total time */}
                <div className="absolute top-5 right-5 z-20 flex flex-col items-end gap-1">
                  <span className="font-mono text-sm tracking-widest text-white/40">
                    {String(currentIndex + 1).padStart(2, '0')} / {String(snippets.length).padStart(2, '0')}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-white/30 font-mono">
                    <Timer className="w-3 h-3" />
                    {formatTime(totalSeconds)}
                  </span>
                </div>

                {/* Bottom controls row */}
                <div className="absolute bottom-8 right-8 z-20 flex items-center gap-2">

                  {/* Voice reader toggle */}
                  <button
                    onClick={() => setVoiceEnabled(v => !v)}
                    className={cn(
                      "p-3 rounded-full backdrop-blur-md border transition-all",
                      voiceEnabled
                        ? "bg-primary/30 border-primary/50 text-primary"
                        : "bg-black/30 border-white/10 text-white/60 hover:text-white hover:bg-black/60"
                    )}
                    title={voiceEnabled ? "Voice narration on — click to turn off" : "Turn on voice narration"}
                  >
                    {voiceEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                  </button>

                  {/* Settings toggle */}
                  <button
                    onClick={() => setSettingsOpen(v => !v)}
                    className={cn(
                      "p-3 rounded-full backdrop-blur-md border transition-all",
                      settingsOpen
                        ? "bg-primary/30 border-primary/50 text-primary"
                        : "bg-black/30 border-white/10 text-white/60 hover:text-white hover:bg-black/60"
                    )}
                    title="Playback settings"
                  >
                    <SlidersHorizontal className="w-5 h-5" />
                  </button>

                  {/* Prev / Next */}
                  <button
                    onClick={prev}
                    className="p-3 rounded-full bg-black/30 backdrop-blur-md border border-white/10 text-white/60 hover:text-white hover:bg-black/60 transition-all"
                    title="Previous chapter"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    onClick={next}
                    className="p-3 rounded-full bg-black/30 backdrop-blur-md border border-white/10 text-white/60 hover:text-white hover:bg-black/60 transition-all"
                    title="Next chapter"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                </div>

                {/* Settings panel */}
                <AnimatePresence>
                  {settingsOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 12, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 12, scale: 0.95 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className="absolute bottom-24 right-8 z-30 bg-black/70 backdrop-blur-xl border border-white/15 rounded-2xl p-5 w-72 shadow-2xl"
                    >
                      <p className="text-xs text-white/40 uppercase tracking-widest mb-4 font-medium">Playback Settings</p>

                      {/* Timing — only shown when voice is off */}
                      {!voiceEnabled ? (
                        <div className="space-y-2">
                          <p className="text-sm text-white/70 font-medium">Chapter duration</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {TIMING_OPTIONS.map(opt => (
                              <button
                                key={opt.value}
                                onClick={() => setIntervalMs(opt.value)}
                                className={cn(
                                  "px-3 py-1.5 rounded-full text-xs font-medium transition-all border",
                                  intervalMs === opt.value
                                    ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/30"
                                    : "bg-white/10 text-white/60 border-white/10 hover:bg-white/20 hover:text-white"
                                )}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 rounded-xl bg-primary/10 border border-primary/20 text-xs text-primary/80 leading-relaxed">
                          <p className="font-medium mb-1">Voice controls timing</p>
                          <p className="opacity-70">Each chapter plays for exactly as long as it takes to read aloud. Current chapter: ~{Math.round(computeReadingMs(currentSnippet) / 1000)}s</p>
                        </div>
                      )}

                      <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                        <p className="text-sm text-white/70 font-medium">Voice reader</p>
                        <div
                          onClick={() => setVoiceEnabled(v => !v)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                            voiceEnabled
                              ? "bg-primary/20 border-primary/40 text-primary"
                              : "bg-white/5 border-white/10 text-white/50 hover:bg-white/10"
                          )}
                        >
                          <div>
                            <p className="text-xs font-medium leading-tight">
                              {voiceEnabled ? 'Voice on' : 'Voice off'}
                            </p>
                            <p className="text-[10px] opacity-60 leading-tight mt-0.5">
                              {voiceEnabled ? 'Reads each chapter aloud' : 'Click to enable narration'}
                            </p>
                          </div>
                          <div className={cn(
                            "ml-auto w-9 h-5 rounded-full transition-all relative shrink-0",
                            voiceEnabled ? "bg-primary" : "bg-white/20"
                          )}>
                            <div className={cn(
                              "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow",
                              voiceEnabled ? "left-[18px]" : "left-0.5"
                            )} />
                          </div>
                        </div>
                      </div>

                      {/* Total time */}
                      <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between text-xs text-white/40">
                        <span className="flex items-center gap-1.5"><Timer className="w-3.5 h-3.5" /> Time watched</span>
                        <span className="font-mono text-white/60">{formatTime(totalSeconds)}</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Chapter dot navigation */}
                {snippets.length <= 12 && (
                  <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5">
                    {snippets.map((_, i) => (
                      <button
                        key={i}
                        onClick={() => goTo(i)}
                        className={cn(
                          "rounded-full transition-all duration-300",
                          i === currentIndex
                            ? "w-6 h-2 bg-primary"
                            : "w-2 h-2 bg-white/30 hover:bg-white/60"
                        )}
                      />
                    ))}
                  </div>
                )}

                {/* Progress bar */}
                <ProgressBar
                  duration={activeInterval}
                  slideKey={`${currentSnippet.id}-${activeInterval}`}
                  isPaused={false}
                  voiceProgress={voiceEnabled ? playProgress : undefined}
                  isVoiceLoading={voiceEnabled ? isVoiceLoading : undefined}
                />
              </>
            )}
          </>
        )}
      </div>

      <AmbientMusicPlayer />
      <NewsAdminPanel onArticleAdded={handleArticleAdded} />
    </main>
  );
}
