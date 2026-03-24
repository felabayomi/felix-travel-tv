import { useState, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Newspaper, ChevronLeft, ChevronRight, LayoutList, X } from 'lucide-react';
import {
  useGetArticles,
  useGetArticleSnippets,
  useDeleteArticle,
  getGetArticlesQueryKey,
} from '@workspace/api-client-react';
import type { Article } from '@workspace/api-client-react/src/generated/api.schemas';
import { useQueryClient } from '@tanstack/react-query';
import { useSnippetPlayer } from '@/hooks/use-snippet-player';
import { SnippetDisplay } from '@/components/SnippetDisplay';
import { ArticleSidebar } from '@/components/ArticleSidebar';
import { ProgressBar } from '@/components/ProgressBar';
import { NewsAdminPanel } from '@/components/NewsAdminPanel';
import { AmbientMusicPlayer } from '@/components/AmbientMusicPlayer';
import { cn } from '@/lib/utils';

const SNIPPET_INTERVAL = 12000;

export function NewsPage() {
  const queryClient = useQueryClient();
  const { data: articles = [], isLoading, isError } = useGetArticles();

  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  const { currentIndex, currentSnippet, next, prev, goTo } = useSnippetPlayer(snippets, SNIPPET_INTERVAL);

  const selectedArticle = articles.find(a => a.id === selectedArticleId) ?? null;

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
    // Auto-select the latest article once data refreshes
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

                {/* Chapter counter — top right */}
                <div className="absolute top-5 right-16 z-20 font-mono text-sm tracking-widest text-white/40">
                  {String(currentIndex + 1).padStart(2, '0')} / {String(snippets.length).padStart(2, '0')}
                </div>

                {/* Prev/Next chapter buttons */}
                <div className="absolute bottom-8 right-8 z-20 flex items-center gap-3">
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
                  duration={SNIPPET_INTERVAL}
                  slideKey={currentSnippet.id}
                  isPaused={false}
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
