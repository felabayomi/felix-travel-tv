import { motion } from 'framer-motion';

interface ProgressBarProps {
  duration: number;
  slideKey: string | number;
  isPaused: boolean;
}

export function ProgressBar({ duration, slideKey, isPaused }: ProgressBarProps) {
  return (
    <div className="absolute bottom-0 left-0 w-full h-1.5 bg-black/40 z-30 overflow-hidden">
      <motion.div
        key={slideKey} // Changing the key restarts the animation
        initial={{ width: 0 }}
        animate={{ width: isPaused ? 'auto' : '100%' }}
        transition={{ 
          duration: duration / 1000, 
          ease: "linear"
        }}
        className="h-full bg-primary origin-left glow-primary"
      />
    </div>
  );
}
