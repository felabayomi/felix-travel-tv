import { Volume2, VolumeX } from 'lucide-react';
import { useAmbientMusic } from '@/hooks/use-ambient-music';
import { cn } from '@/lib/utils';

export function AmbientMusicPlayer() {
  const { isPlaying, toggle } = useAmbientMusic();

  return (
    <button
      onClick={toggle}
      title={isPlaying ? 'Mute music' : 'Play ambient music'}
      className={cn(
        "fixed bottom-6 right-20 p-3 rounded-full backdrop-blur-md transition-all duration-300 z-40 group",
        isPlaying
          ? "bg-primary/20 text-primary border border-primary/30"
          : "bg-black/20 text-white/50 border border-white/10 hover:bg-black/50 hover:text-white"
      )}
    >
      {isPlaying ? (
        <Volume2 className="w-5 h-5" />
      ) : (
        <VolumeX className="w-5 h-5" />
      )}
    </button>
  );
}
