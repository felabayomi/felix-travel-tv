import { useEffect, useCallback, useRef } from 'react';

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

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, []);

  const speak = useCallback(async (snippetId: number) => {
    if (!enabled) return;
    stop();
    try {
      const blobUrl = await fetchAudioBlobUrl(snippetId);
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.volume = 0.85;
      }
      audioRef.current.src = blobUrl;
      await audioRef.current.play();
    } catch (err) {
      console.warn('[voice] TTS playback error:', err);
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

  return { speak, stop, prefetch };
}
