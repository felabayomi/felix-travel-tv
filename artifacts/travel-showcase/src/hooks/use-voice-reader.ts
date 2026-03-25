import { useEffect, useCallback, useRef, useState } from 'react';

// In-memory blob URL cache so we don't re-fetch audio for chapters already seen
const audioCache = new Map<number, string>(); // snippetId → blobURL

async function fetchAudioBlobUrl(snippetId: number): Promise<string> {
  if (audioCache.has(snippetId)) return audioCache.get(snippetId)!;
  const res = await fetch(`/api/snippets/${snippetId}/audio`);
  if (!res.ok) throw new Error(`TTS fetch failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  audioCache.set(snippetId, url);
  return url;
}

export function useVoiceReader(enabled: boolean) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [playProgress, setPlayProgress] = useState(0); // 0–1

  function getAudio(): HTMLAudioElement {
    if (!audioRef.current) {
      const el = new Audio();
      el.volume = 0.85;
      audioRef.current = el;
    }
    return audioRef.current;
  }

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el) {
      el.onended = null;
      el.ontimeupdate = null;
      el.pause();
      el.currentTime = 0;
    }
    setIsLoading(false);
    setPlayProgress(0);
  }, []);

  const speak = useCallback(async (snippetId: number, onEnded?: () => void) => {
    if (!enabled) return;
    stop();
    setIsLoading(true);
    setPlayProgress(0);

    try {
      const blobUrl = await fetchAudioBlobUrl(snippetId);
      const el = getAudio();

      el.src = blobUrl;

      el.ontimeupdate = () => {
        if (el.duration > 0) {
          setPlayProgress(el.currentTime / el.duration);
        }
      };

      el.onended = () => {
        setPlayProgress(1);
        el.onended = null;
        el.ontimeupdate = null;
        if (onEnded) onEnded();
      };

      setIsLoading(false);
      await el.play();
    } catch (err) {
      console.warn('[voice] TTS playback error:', err);
      setIsLoading(false);
      // If audio fails, still advance after a short delay so slideshow doesn't freeze
      if (onEnded) setTimeout(onEnded, 2000);
    }
  }, [enabled, stop]);

  // Prefetch audio for a snippet in the background (no playback)
  const prefetch = useCallback((snippetId: number) => {
    if (!enabled) return;
    fetchAudioBlobUrl(snippetId).catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { speak, stop, prefetch, isLoading, playProgress };
}
