import { useGetSlides } from '@workspace/api-client-react';
import { useSlideshow } from '@/hooks/use-slideshow';
import { SlideDisplay } from '@/components/SlideDisplay';
import { AdminPanel } from '@/components/AdminPanel';
import { ProgressBar } from '@/components/ProgressBar';
import { AmbientMusicPlayer } from '@/components/AmbientMusicPlayer';
import { Loader2, Globe } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRef, useEffect, useCallback, useMemo } from 'react';

export function ShowcasePage() {
  const { data: slides = [], isLoading, isError } = useGetSlides();
  const intervalMs = 12000;
  
  const { currentIndex, isPaused, goTo } = useSlideshow(slides, intervalMs);

  // Reactive jump: set this ref to the count we're waiting for,
  // and as soon as slides.length reaches it we navigate there.
  const jumpWhenCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (jumpWhenCountRef.current !== null && slides.length >= jumpWhenCountRef.current) {
      goTo(slides.length - 1);
      jumpWhenCountRef.current = null;
    }
  }, [slides.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by AdminPanel right before it triggers the add —
  // tells us to jump to the last slide once data arrives.
  const requestJumpToNext = useCallback(() => {
    jumpWhenCountRef.current = slides.length + 1;
  }, [slides.length]);

  // Preload the next 2 slides' images so transitions are instant,
  // even on the first pass through the deck.
  const nextImageUrls = useMemo(() => {
    if (slides.length <= 1) return [];
    return [1, 2]
      .map(offset => slides[(currentIndex + offset) % slides.length]?.imageUrl)
      .filter((url): url is string => Boolean(url));
  }, [currentIndex, slides]);

  useEffect(() => {
    nextImageUrls.forEach(url => {
      const img = new Image();
      img.src = url;
    });
  }, [nextImageUrls]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-primary">
        <Loader2 className="w-12 h-12 animate-spin mb-6 opacity-80" />
        <h2 className="font-display text-2xl tracking-widest uppercase">Initializing System</h2>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-destructive">
        <div className="text-center">
          <h2 className="font-display text-2xl mb-2">System Offline</h2>
          <p className="text-muted-foreground">Unable to connect to the showcase network.</p>
        </div>
      </div>
    );
  }

  const isEmpty = slides.length === 0;

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-background">
      
      {isEmpty ? (
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-background to-background flex flex-col items-center justify-center text-center p-8">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1 }}
            className="flex flex-col items-center"
          >
            <Globe className="w-24 h-24 text-primary/30 mb-8 glow-primary" />
            <h1 className="text-4xl md:text-6xl font-display font-bold text-white mb-4">Product Showcase</h1>
            <p className="text-xl text-muted-foreground max-w-lg font-light leading-relaxed">
              The display is active but no products have been loaded. 
              Open the admin panel in the bottom right corner to add your first product.
            </p>
          </motion.div>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {slides.map((slide, index) => (
            <SlideDisplay 
              key={slide.id} 
              slide={slide} 
              isActive={index === currentIndex} 
            />
          ))}
        </AnimatePresence>
      )}

      {!isEmpty && (
        <>
          <ProgressBar 
            duration={intervalMs} 
            slideKey={slides[currentIndex]?.id || 'init'} 
            isPaused={isPaused}
          />
          <div className="absolute top-8 right-8 z-30 font-mono text-sm tracking-widest text-white/40">
            {String(currentIndex + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}
          </div>
        </>
      )}

      <AmbientMusicPlayer />
      <AdminPanel goTo={goTo} requestJumpToNext={requestJumpToNext} />
    </main>
  );
}
