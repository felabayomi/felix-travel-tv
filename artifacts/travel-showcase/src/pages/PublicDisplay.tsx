import { useEffect, useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Newspaper, Radio } from 'lucide-react';
import { useGetArticles, useGetArticleSnippets } from '@workspace/api-client-react';
import { ProgressBar } from '@/components/ProgressBar';
import { SnippetDisplay } from '@/components/SnippetDisplay';
import { AmbientMusicPlayer } from '@/components/AmbientMusicPlayer';

interface PlaybackState {
  articleId: number | null;
  snippetIndex: number;
  updatedAt: number;
}

const POLL_MS = 2000;

function usePlaybackSync() {
  const [state, setState] = useState<PlaybackState>({ articleId: null, snippetIndex: 0, updatedAt: 0 });

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch('/api/playback');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setState(prev =>
            data.updatedAt !== prev.updatedAt ? data : prev
          );
        }
      } catch { /* network error — keep last state */ }
    }
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return state;
}

export function PublicDisplay() {
  const { articleId, snippetIndex } = usePlaybackSync();
  const { data: articles = [] } = useGetArticles();
  const { data: snippets = [], isLoading: isLoadingSnippets } = useGetArticleSnippets(
    articleId ?? 0,
    { query: { enabled: articleId !== null } }
  );

  const safeIndex = Math.min(snippetIndex, Math.max(0, snippets.length - 1));
  const currentSnippet = snippets[safeIndex] ?? null;
  const selectedArticle = articles.find(a => a.id === articleId) ?? null;

  // Tick used to reset the progress bar when admin navigates chapters
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
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-center p-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1 }}
          className="flex flex-col items-center"
        >
          <Newspaper className="w-24 h-24 text-primary/20 mb-8" />
          <h1 className="text-4xl md:text-6xl font-display font-bold text-white mb-4">News Reader</h1>
          <p className="text-xl text-muted-foreground font-light leading-relaxed max-w-md">
            Waiting for admin to start a story...
          </p>
          <p className="mt-6 text-xs text-muted-foreground/30 tracking-widest uppercase">
            Public Display
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-background">

      {/* Snippet slideshow */}
      {isLoadingSnippets ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary/40" />
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

      {/* Article info — top left */}
      {selectedArticle && (
        <div className="absolute top-5 left-5 z-20 max-w-xs">
          <p className="text-xs text-white/40 uppercase tracking-widest mb-0.5">
            {selectedArticle.source || 'News'}
          </p>
          <p className="text-sm font-medium text-white/60 line-clamp-2 leading-snug">
            {selectedArticle.title}
          </p>
        </div>
      )}

      {/* Chapter counter — top right */}
      {snippets.length > 0 && (
        <div className="absolute top-5 right-5 z-20 flex flex-col items-end gap-1.5">
          <span className="font-mono text-sm tracking-widest text-white/40">
            {String(safeIndex + 1).padStart(2, '0')} / {String(snippets.length).padStart(2, '0')}
          </span>
          {/* LIVE indicator */}
          <span className="flex items-center gap-1.5 text-[11px] text-primary/70 font-medium uppercase tracking-widest">
            <Radio className="w-3 h-3 animate-pulse" />
            Live
          </span>
        </div>
      )}

      {/* Dot navigation — bottom center (read only) */}
      {snippets.length > 0 && snippets.length <= 12 && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 pointer-events-none">
          {snippets.map((_, i) => (
            <div
              key={i}
              className={`rounded-full transition-all duration-300 ${
                i === safeIndex ? 'w-6 h-2 bg-primary' : 'w-2 h-2 bg-white/20'
              }`}
            />
          ))}
        </div>
      )}

      {/* Progress bar — resets when admin navigates */}
      {currentSnippet && (
        <ProgressBar
          duration={20000}
          slideKey={`public-${currentSnippet.id}-${tick}`}
          isPaused={false}
        />
      )}

      <AmbientMusicPlayer />
    </main>
  );
}
