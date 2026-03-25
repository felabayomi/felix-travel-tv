import { motion } from 'framer-motion';

interface ProgressBarProps {
  duration: number;
  slideKey: string | number;
  isPaused: boolean;
  isVoiceMode?: boolean;
}

export function ProgressBar({ duration, slideKey, isPaused, isVoiceMode }: ProgressBarProps) {
  if (isVoiceMode) {
    return (
      <div className="absolute bottom-0 left-0 w-full h-1.5 bg-black/40 z-30 overflow-hidden flex items-center gap-[3px] px-0">
        {Array.from({ length: 80 }).map((_, i) => (
          <motion.div
            key={i}
            className="flex-1 rounded-full bg-primary/70"
            animate={{ scaleY: [0.2, 1, 0.2] }}
            transition={{
              duration: 0.8 + Math.random() * 0.6,
              repeat: Infinity,
              delay: i * 0.02,
              ease: 'easeInOut',
            }}
            style={{ height: '100%', transformOrigin: 'bottom' }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="absolute bottom-0 left-0 w-full h-1.5 bg-black/40 z-30 overflow-hidden">
      <motion.div
        key={slideKey}
        initial={{ width: 0 }}
        animate={{ width: isPaused ? 'auto' : '100%' }}
        transition={{
          duration: duration / 1000,
          ease: 'linear',
        }}
        className="h-full bg-primary origin-left"
      />
    </div>
  );
}
