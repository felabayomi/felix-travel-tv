// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️  PROTECTED BROADCAST ENGINE — DO NOT MODIFY WITHOUT READING replit.md FIRST
//
// This hook is part of the autoplay/interlude/voice system. Changes here have
// historically caused audio to overlap, play twice, or cut off mid-sentence.
//
// CRITICAL INVARIANTS (do not break):
//   1. genRef (generation counter) must be incremented at the TOP of every speak()
//      call, and checked after every await. This prevents stale async completions
//      from a previous chapter from overriding a newer chapter that has already started.
//   2. stop() must clear el.onended AND el.ontimeupdate before pausing. If not
//      cleared, the ended callback fires on the stale element after stop() and
//      triggers an unwanted advance to the next chapter.
//   3. On TTS fetch error, onEnded is still called after 2 s. This ensures the
//      slideshow never freezes if audio is unavailable.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

  // Generation counter: incremented on every speak() call.
  // After an async fetch completes, we check the generation matches;
  // if a newer speak() has already started, we discard the stale result.
  const genRef = useRef(0);

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
    genRef.current += 1;
    const myGen = genRef.current;
    stop();
    setIsLoading(true);
    setPlayProgress(0);

    try {
      const blobUrl = await fetchAudioBlobUrl(snippetId);

      // Abort if a newer speak() call has already taken over
      if (genRef.current !== myGen) return;

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
      if (genRef.current !== myGen) return; // stale, ignore
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
