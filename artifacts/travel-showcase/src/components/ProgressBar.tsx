import { motion } from 'framer-motion';

interface ProgressBarProps {
  duration: number;
  slideKey: string | number;
  isPaused: boolean;
  // Voice mode: pass 0–1 progress from audio playback; undefined = timer mode
  voiceProgress?: number;
  // True while audio is loading (show pulsing bar)
  isVoiceLoading?: boolean;
}

export function ProgressBar({ duration, slideKey, isPaused, voiceProgress, isVoiceLoading }: ProgressBarProps) {
  const isVoiceMode = voiceProgress !== undefined || isVoiceLoading;

  if (isVoiceMode) {
    if (isVoiceLoading) {
      // Pulsing shimmer while audio is being fetched
      return (
        <div className="absolute bottom-0 left-0 w-full h-1.5 bg-black/40 z-30 overflow-hidden">
          <motion.div
            className="h-full bg-primary/60 w-1/3"
            animate={{ x: ['0%', '300%'] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>
      );
    }

    // Smooth audio playback progress bar
    return (
      <div className="absolute bottom-0 left-0 w-full h-1.5 bg-black/40 z-30 overflow-hidden">
        <motion.div
          className="h-full bg-primary origin-left"
          style={{ width: `${(voiceProgress ?? 0) * 100}%` }}
          transition={{ duration: 0.15, ease: 'linear' }}
        />
      </div>
    );
  }

  // Timer countdown bar (non-voice mode)
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
