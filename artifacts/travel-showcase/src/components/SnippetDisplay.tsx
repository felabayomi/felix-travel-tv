import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Snippet } from '@workspace/api-client-react/src/generated/api.schemas';

interface SnippetDisplayProps {
  snippet: Snippet;
  isActive: boolean;
  chapterIndex: number;
  totalChapters: number;
}

const bgGradients = [
  'radial-gradient(ellipse at 65% 30%, #0d1a2e 0%, #050508 70%)',
  'radial-gradient(ellipse at 35% 40%, #1a0d2e 0%, #050508 70%)',
  'radial-gradient(ellipse at 60% 25%, #0d2018 0%, #050508 70%)',
  'radial-gradient(ellipse at 40% 35%, #2e1a0d 0%, #050508 70%)',
  'radial-gradient(ellipse at 55% 30%, #0d1e2e 0%, #050508 70%)',
  'radial-gradient(ellipse at 45% 40%, #2e0d1a 0%, #050508 70%)',
];

export function SnippetDisplay({ snippet, isActive, chapterIndex, totalChapters }: SnippetDisplayProps) {
  const [lowerIn, setLowerIn] = useState(false);

  useEffect(() => {
    if (!isActive) { setLowerIn(false); return; }
    const t = setTimeout(() => setLowerIn(true), 350);
    return () => clearTimeout(t);
  }, [isActive, snippet.id]);

  if (!isActive) return null;

  const bg = bgGradients[chapterIndex % bgGradients.length];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6, ease: 'easeInOut' }}
      className="absolute inset-0 w-full h-full overflow-hidden"
      style={{ background: '#050508' }}
    >
      {/* ── Background image or gradient ── */}
      {snippet.imageUrl ? (
        <img
          src={snippet.imageUrl}
          alt={snippet.headline}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="absolute inset-0" style={{ background: bg }} />
      )}

      {/* Scanline texture */}
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, #fff 2px, #fff 3px)',
        }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)',
        }}
      />

      {/* Dark tint over image */}
      {snippet.imageUrl && (
        <div className="absolute inset-0 bg-black/10 pointer-events-none" />
      )}

      {/* ── Top accent line ── */}
      <div
        className="absolute top-0 left-0 right-0 z-10 h-[3px]"
        style={{ background: 'linear-gradient(to right, #c8102e, #ff3333, #c8102e)' }}
      />

      {/* ── Lower third ── */}
      <AnimatePresence>
        {lowerIn && (
          <motion.div
            key={snippet.id}
            className="absolute left-0 z-20 w-full sm:w-auto"
            style={{ bottom: '130px', maxWidth: '92%' }}
            initial={{ y: '110%' }}
            animate={{ y: 0 }}
            exit={{ y: '110%' }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Red left accent stripe */}
            <div
              className="absolute left-0 top-0 bottom-0 w-[5px]"
              style={{ background: '#c8102e' }}
            />

            {/* Panel */}
            <div
              className="ml-[5px] px-4 py-3 sm:px-8 sm:py-5"
              style={{
                background: 'linear-gradient(to right, rgba(3,3,8,0.97) 0%, rgba(3,3,8,0.93) 70%, transparent 100%)',
              }}
            >
              {/* Headline */}
              <h1
                className="text-white leading-tight mb-2 sm:mb-3"
                style={{
                  fontFamily: 'Oswald, sans-serif',
                  fontWeight: 700,
                  fontSize: 'clamp(18px, 4.5vw, 46px)',
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                  textShadow: '0 2px 16px rgba(0,0,0,0.9)',
                  maxWidth: '95%',
                }}
              >
                {snippet.headline}
              </h1>

              {/* Rule */}
              <div className="w-10 h-[2px] mb-2 sm:mb-3" style={{ background: '#c8102e' }} />

              {/* Caption */}
              <p
                className="text-white leading-snug mb-2 sm:mb-3"
                style={{
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  fontWeight: 400,
                  fontSize: 'clamp(12px, 2.5vw, 19px)',
                  letterSpacing: '0.01em',
                  maxWidth: '90%',
                }}
              >
                {snippet.caption}
              </p>

              {/* Divider — hidden on very small screens */}
              <div className="hidden sm:block mb-3" style={{ width: '60%', height: '1px', background: 'rgba(255,255,255,0.12)' }} />

              {/* Explanation — hidden on small phones to avoid overflow */}
              <p
                className="hidden sm:block text-white/65 leading-relaxed"
                style={{
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  fontWeight: 300,
                  fontSize: 'clamp(14px, 1.6vw, 22px)',
                  maxWidth: '80%',
                }}
              >
                {snippet.explanation}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </motion.div>
  );
}
