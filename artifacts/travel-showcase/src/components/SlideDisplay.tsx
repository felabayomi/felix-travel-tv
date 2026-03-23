import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Globe, ArrowRight } from 'lucide-react';
import type { Slide } from '@workspace/api-client-react/src/generated/api.schemas';
import { cn, getCategoryGradient } from '@/lib/utils';

interface SlideDisplayProps {
  slide: Slide;
  isActive: boolean;
}

function isAppleAppStore(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname.includes('apps.apple.com') || hostname.includes('itunes.apple.com');
  } catch {
    return false;
  }
}

function isGooglePlayStore(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname.includes('play.google.com');
  } catch {
    return false;
  }
}

function getDisplayUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function AppleStoreBadge() {
  return (
    <div className="inline-flex items-center gap-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-6 py-3.5 shadow-2xl">
      {/* Apple logo SVG */}
      <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white shrink-0" xmlns="http://www.w3.org/2000/svg">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
      </svg>
      <div className="flex flex-col">
        <span className="text-white/60 text-xs font-medium tracking-widest uppercase leading-none mb-0.5">Download on the</span>
        <span className="text-white text-xl font-bold tracking-tight leading-none">App Store</span>
      </div>
    </div>
  );
}

function GooglePlayBadge() {
  return (
    <div className="inline-flex items-center gap-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-6 py-3.5 shadow-2xl">
      <svg viewBox="0 0 24 24" className="w-7 h-7 fill-white shrink-0" xmlns="http://www.w3.org/2000/svg">
        <path d="M3.18 23.76c.3.17.64.23.99.17l13.5-7.79-2.83-2.83L3.18 23.76zm-1.5-20.3C1.25 3.82 1 4.28 1 4.83v14.34c0 .55.25 1.01.68 1.37l.09.07 8.04-8.04v-.19L1.68 3.46l-.05.04zM20.56 10.4l-2.67-1.54-3.17 3.17 3.17 3.17 2.7-1.55c.77-.44.77-1.8-.03-2.25zM4.17.24L17.67 8.02l-2.83 2.83L7.2 3.21 4.17.24z"/>
      </svg>
      <div className="flex flex-col">
        <span className="text-white/60 text-xs font-medium tracking-widest uppercase leading-none mb-0.5">Get it on</span>
        <span className="text-white text-xl font-bold tracking-tight leading-none">Google Play</span>
      </div>
    </div>
  );
}

function VisitCTA({ url }: { url: string }) {
  const domain = getDisplayUrl(url);
  return (
    <div className="inline-flex items-center gap-4 bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl px-6 py-3.5 shadow-2xl">
      <Globe className="w-6 h-6 text-white/70 shrink-0" />
      <div className="flex flex-col">
        <span className="text-white/60 text-xs font-medium tracking-widest uppercase leading-none mb-0.5">Visit us at</span>
        <span className="text-white text-xl font-bold tracking-tight leading-none">{domain}</span>
      </div>
      <ArrowRight className="w-5 h-5 text-white/50 shrink-0 ml-1" />
    </div>
  );
}

export function SlideDisplay({ slide, isActive }: SlideDisplayProps) {
  if (!isActive) return null;

  const isAppStore = isAppleAppStore(slide.url);
  const isPlayStore = isGooglePlayStore(slide.url);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 w-full h-full overflow-hidden"
    >
      {/* Background Layer */}
      {slide.imageUrl ? (
        <img
          src={slide.imageUrl}
          alt={slide.title}
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className={cn("absolute inset-0 w-full h-full", getCategoryGradient(slide.category))} />
      )}

      {/* Vignette / Gradient Overlays */}
      <div className="absolute inset-0 bg-black/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent opacity-90" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent opacity-80" />

      {/* Content Layer */}
      <div className="absolute inset-0 p-8 md:p-16 lg:p-24 flex flex-col justify-end">
        <div className="max-w-4xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={slide.id}
              initial="hidden"
              animate="visible"
              exit="hidden"
              variants={{
                hidden: { opacity: 0 },
                visible: { opacity: 1, transition: { staggerChildren: 0.15, delayChildren: 0.3 } }
              }}
              className="space-y-5"
            >
              {/* Category Badge */}
              <motion.div
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } }
                }}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 border border-primary/30 backdrop-blur-md text-primary font-medium tracking-widest text-sm uppercase"
              >
                <MapPin className="w-4 h-4" />
                {slide.category || 'Discovery'}
              </motion.div>

              {/* Title & Tagline */}
              <div className="space-y-2">
                <motion.h1
                  variants={{
                    hidden: { opacity: 0, y: 30 },
                    visible: { opacity: 1, y: 0, transition: { duration: 1, ease: [0.16, 1, 0.3, 1] } }
                  }}
                  className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-white leading-tight"
                >
                  {slide.title}
                </motion.h1>
                <motion.p
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0, transition: { duration: 1, ease: "easeOut" } }
                  }}
                  className="text-xl md:text-3xl font-light text-primary tracking-wide"
                >
                  {slide.tagline}
                </motion.p>
              </div>

              {/* Summary */}
              <motion.p
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 1, ease: "easeOut" } }
                }}
                className="text-lg md:text-xl text-gray-300 max-w-2xl leading-relaxed drop-shadow-md"
              >
                {slide.summary}
              </motion.p>

              {/* Call to Action */}
              <motion.div
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: "easeOut", delay: 0.6 } }
                }}
                className="pt-4"
              >
                {isAppStore ? (
                  <AppleStoreBadge />
                ) : isPlayStore ? (
                  <GooglePlayBadge />
                ) : (
                  <VisitCTA url={slide.url} />
                )}
              </motion.div>

            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
