import { motion, AnimatePresence } from 'framer-motion';
import { Newspaper } from 'lucide-react';
import type { Snippet } from '@workspace/api-client-react/src/generated/api.schemas';
import { cn } from '@/lib/utils';

interface SnippetDisplayProps {
  snippet: Snippet;
  isActive: boolean;
  chapterIndex: number;
  totalChapters: number;
}

const newsGradients = [
  'bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950',
  'bg-gradient-to-br from-zinc-900 via-purple-950 to-slate-950',
  'bg-gradient-to-br from-stone-900 via-amber-950 to-orange-950',
  'bg-gradient-to-br from-gray-900 via-emerald-950 to-teal-950',
  'bg-gradient-to-br from-slate-900 via-rose-950 to-pink-950',
  'bg-gradient-to-br from-neutral-900 via-sky-950 to-cyan-950',
];

export function SnippetDisplay({ snippet, isActive, chapterIndex, totalChapters }: SnippetDisplayProps) {
  if (!isActive) return null;

  const fallbackGradient = newsGradients[chapterIndex % newsGradients.length];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 w-full h-full overflow-hidden"
    >
      {/* Background */}
      {snippet.imageUrl ? (
        <img
          src={snippet.imageUrl}
          alt={snippet.headline}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className={cn("absolute inset-0 w-full h-full", fallbackGradient)} />
      )}

      {/* Overlays — lighter to let the image breathe */}
      <div className="absolute inset-0 bg-black/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-black/10 to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 p-8 md:p-14 lg:p-20 flex flex-col justify-end">
        <div className="max-w-3xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={snippet.id}
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={{
                hidden: { opacity: 0 },
                visible: { opacity: 1, transition: { staggerChildren: 0.12, delayChildren: 0.25 } }
              }}
              className="space-y-4"
            >
              {/* Chapter badge */}
              <motion.div
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease: "easeOut" } }
                }}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/20 border border-primary/30 backdrop-blur-md text-primary font-medium tracking-widest text-xs uppercase"
              >
                <Newspaper className="w-3.5 h-3.5" />
                Chapter {chapterIndex + 1} of {totalChapters}
              </motion.div>

              {/* Headline */}
              <motion.h1
                variants={{
                  hidden: { opacity: 0, y: 28 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] } }
                }}
                className="text-4xl md:text-6xl lg:text-7xl font-display font-bold text-white leading-tight"
              >
                {snippet.headline}
              </motion.h1>

              {/* Caption */}
              <motion.p
                variants={{
                  hidden: { opacity: 0, y: 18 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: "easeOut" } }
                }}
                className="text-xl md:text-2xl font-light text-primary tracking-wide leading-snug"
              >
                {snippet.caption}
              </motion.p>

              {/* Explanation */}
              <motion.p
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: "easeOut" } }
                }}
                className="text-base md:text-lg text-gray-300 max-w-2xl leading-relaxed drop-shadow-md"
              >
                {snippet.explanation}
              </motion.p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
