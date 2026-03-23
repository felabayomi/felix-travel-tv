import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, ArrowRight } from 'lucide-react';
import type { Slide } from '@workspace/api-client-react/src/generated/api.schemas';
import { cn, getCategoryGradient } from '@/lib/utils';

interface SlideDisplayProps {
  slide: Slide;
  isActive: boolean;
}

export function SlideDisplay({ slide, isActive }: SlideDisplayProps) {
  if (!isActive) return null;

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

      {/* Vignette / Gradient Overlays for depth and readability */}
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
              className="space-y-6"
            >
              {/* Category Badge */}
              <motion.div 
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease: "easeOut" } }
                }}
                className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/20 border border-primary/30 backdrop-blur-md text-primary font-medium tracking-widest text-sm uppercase glow-primary"
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
                  className="text-5xl md:text-7xl lg:text-8xl font-display font-bold text-white text-glow leading-tight"
                >
                  {slide.title}
                </motion.h1>
                <motion.p 
                  variants={{
                    hidden: { opacity: 0, y: 20 },
                    visible: { opacity: 1, y: 0, transition: { duration: 1, ease: "easeOut" } }
                  }}
                  className="text-xl md:text-3xl font-light text-primary tracking-wide text-glow"
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

              {/* URL Link */}
              <motion.div 
                variants={{
                  hidden: { opacity: 0 },
                  visible: { opacity: 1, transition: { duration: 1, delay: 1 } }
                }}
                className="pt-8"
              >
                <div className="inline-flex items-center gap-3 text-white/50 hover:text-white transition-colors duration-300 group">
                  <span className="text-sm tracking-wider font-light">{new URL(slide.url).hostname}</span>
                  <ArrowRight className="w-4 h-4 opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                </div>
              </motion.div>

            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
