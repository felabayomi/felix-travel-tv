import { motion, AnimatePresence } from 'framer-motion';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { Newspaper, Trash2, Loader2, ExternalLink, ChevronRight } from 'lucide-react';
import type { Article } from '@workspace/api-client-react/src/generated/api.schemas';
import { cn } from '@/lib/utils';

interface ArticleSidebarProps {
  articles: Article[];
  selectedId: number | null;
  onSelect: (article: Article) => void;
  onDelete: (id: number) => void;
  isDeleting: boolean;
  isOpen: boolean;
}

function groupByDate(articles: Article[]): { label: string; items: Article[] }[] {
  const groups: Record<string, Article[]> = {};
  articles.forEach(a => {
    const date = parseISO(a.publishedAt);
    let label: string;
    if (isToday(date)) label = 'Today';
    else if (isYesterday(date)) label = 'Yesterday';
    else label = format(date, 'MMMM d, yyyy');
    if (!groups[label]) groups[label] = [];
    groups[label].push(a);
  });
  return Object.entries(groups).map(([label, items]) => ({ label, items }));
}

export function ArticleSidebar({
  articles,
  selectedId,
  onSelect,
  onDelete,
  isDeleting,
  isOpen,
}: ArticleSidebarProps) {
  const groups = groupByDate(articles);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: '-100%' }}
          animate={{ x: 0 }}
          exit={{ x: '-100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 220 }}
          className="absolute left-0 top-0 bottom-0 w-72 bg-black/80 backdrop-blur-xl border-r border-white/10 z-20 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <Newspaper className="w-5 h-5 text-primary" />
              <h2 className="font-display font-bold text-white text-base tracking-wide">News Feed</h2>
            </div>
            <p className="text-xs text-white/40 mt-1">{articles.length} article{articles.length !== 1 ? 's' : ''} loaded</p>
          </div>

          {/* Articles grouped by date */}
          <div className="flex-1 overflow-y-auto py-3 space-y-1">
            {articles.length === 0 ? (
              <div className="p-6 text-center text-white/30 text-sm">
                No articles yet. Add a URL to get started.
              </div>
            ) : (
              groups.map(group => (
                <div key={group.label}>
                  <div className="px-5 py-2">
                    <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">
                      {group.label}
                    </span>
                  </div>
                  {group.items.map(article => (
                    <motion.button
                      key={article.id}
                      onClick={() => onSelect(article)}
                      whileHover={{ x: 3 }}
                      className={cn(
                        "w-full text-left px-4 py-3 mx-1 rounded-xl transition-all duration-200 group flex items-start gap-3",
                        selectedId === article.id
                          ? "bg-primary/20 border border-primary/30"
                          : "hover:bg-white/5 border border-transparent"
                      )}
                    >
                      <ChevronRight className={cn(
                        "w-4 h-4 mt-0.5 shrink-0 transition-colors",
                        selectedId === article.id ? "text-primary" : "text-white/20 group-hover:text-white/50"
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className={cn(
                          "text-sm font-medium leading-snug line-clamp-2",
                          selectedId === article.id ? "text-white" : "text-white/70 group-hover:text-white"
                        )}>
                          {article.title}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          {article.source && (
                            <span className="text-[10px] text-primary/70 truncate max-w-[100px]">{article.source}</span>
                          )}
                          <span className="text-[10px] text-white/30">
                            {article.snippetCount} chapter{article.snippetCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="p-1 rounded hover:text-primary text-white/40 transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (confirm('Remove this article?')) onDelete(article.id);
                          }}
                          disabled={isDeleting}
                          className="p-1 rounded hover:text-red-400 text-white/40 transition-colors disabled:opacity-30"
                        >
                          {isDeleting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        </button>
                      </div>
                    </motion.button>
                  ))}
                </div>
              ))
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
