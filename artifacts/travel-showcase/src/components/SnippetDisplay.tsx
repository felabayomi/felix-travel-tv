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
            className="absolute left-0 right-0 z-20"
            style={{ bottom: '110px' }}
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
              className="ml-[5px] px-8 py-5"
              style={{
                background: 'linear-gradient(to right, rgba(3,3,8,0.97) 0%, rgba(3,3,8,0.93) 70%, transparent 100%)',
              }}
            >
              {/* Headline */}
              <h1
                className="text-white leading-none mb-3"
                style={{
                  fontFamily: 'Oswald, sans-serif',
                  fontWeight: 700,
                  fontSize: 'clamp(24px, 3.6vw, 46px)',
                  letterSpacing: '0.02em',
                  textTransform: 'uppercase',
                  textShadow: '0 2px 16px rgba(0,0,0,0.9)',
                  maxWidth: '80%',
                }}
              >
                {snippet.headline}
              </h1>

              {/* Rule */}
              <div className="w-14 h-[2px] mb-3" style={{ background: '#c8102e' }} />

              {/* Caption */}
              <p
                className="text-white/80 leading-snug mb-3"
                style={{
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  fontWeight: 400,
                  fontSize: 'clamp(13px, 1.5vw, 19px)',
                  letterSpacing: '0.01em',
                  maxWidth: '75%',
                }}
              >
                {snippet.caption}
              </p>

              {/* Explanation */}
              <p
                className="text-white/50 leading-relaxed"
                style={{
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  fontWeight: 300,
                  fontSize: 'clamp(11px, 1vw, 13px)',
                  maxWidth: '68%',
                }}
              >
                {snippet.explanation}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom ticker ── */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 flex items-center overflow-hidden"
        style={{
          height: '48px',
          background: 'rgba(3,3,8,0.97)',
          borderTop: '2px solid #c8102e',
        }}
      >
        {/* Label */}
        <div
          className="flex-shrink-0 flex items-center gap-2 h-full px-4"
          style={{ background: '#c8102e' }}
        >
          <img
            src="/ticker-logo.png"
            alt="logo"
            style={{ height: '28px', width: 'auto', objectFit: 'contain', display: 'block' }}
          />
          <span
            style={{
              fontFamily: 'Oswald, sans-serif',
              color: '#fff',
              fontWeight: 700,
              fontSize: '12px',
              letterSpacing: '0.1em',
            }}
          >
            NEWS
          </span>
        </div>

        {/* Scrolling caption */}
        <div className="flex-1 overflow-hidden">
          <div
            className="flex gap-24 whitespace-nowrap"
            style={{ animation: 'ticker-scroll 20s linear infinite', paddingLeft: '100%' }}
          >
            {[snippet.caption, snippet.headline, snippet.caption, snippet.headline].map((text, i) => (
              <span
                key={i}
                style={{
                  fontFamily: 'IBM Plex Sans, sans-serif',
                  fontWeight: 500,
                  fontSize: '12px',
                  color: 'rgba(255,255,255,0.8)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                {text}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Ticker keyframe ── */}
      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </motion.div>
  );
}
