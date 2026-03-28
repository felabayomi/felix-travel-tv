// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ⚠️  PROTECTED BROADCAST ENGINE — DO NOT MODIFY WITHOUT READING replit.md FIRST
//
// Uses the browser's Web Speech API (SpeechSynthesis) for TTS:
//   - No server audio download — avoids VBR/MP3 header issues that caused
//     premature `ended` events with concatenated Google TTS chunks.
//   - No OpenAI audio endpoint needed — Replit's AI proxy doesn't support it.
//   - The `onend` event on a SpeechSynthesisUtterance fires reliably when the
//     browser finishes speaking — it is never fired early.
//
// CRITICAL INVARIANTS (do not break):
//   1. genRef (generation counter) must be incremented at the TOP of every speak()
//      call, and checked after every await. Prevents stale async completions
//      from overriding a newer chapter that has already started.
//   2. stop() must call window.speechSynthesis.cancel() AND nullify utteranceRef.
//      If not cleared, onend fires on the stale utterance and triggers an unwanted advance.
//   3. On fetch/speech error, onEnded is still called after 2 s so the slideshow
//      never freezes if speech is unavailable.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { useEffect, useCallback, useRef, useState } from 'react';

// In-memory text cache so we don't re-fetch snippet text for chapters already seen
const textCache = new Map<number, string>(); // snippetId → text

async function fetchSnippetText(snippetId: number): Promise<string> {
  if (textCache.has(snippetId)) return textCache.get(snippetId)!;
  const res = await fetch(`/api/snippets/${snippetId}/text`);
  if (!res.ok) throw new Error(`Text fetch failed: ${res.status}`);
  const { text } = await res.json();
  textCache.set(snippetId, text);
  return text;
}

export function useVoiceReader(enabled: boolean) {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [playProgress, setPlayProgress] = useState(0); // 0–1

  // Generation counter: incremented on every speak() call.
  // After the async text fetch completes, we verify the generation still matches;
  // if a newer speak() has already started, we discard the stale result.
  const genRef = useRef(0);

  // Word-boundary progress tracking
  const wordCountRef = useRef(0);
  const wordIndexRef = useRef(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearProgressTimer() {
    if (progressTimerRef.current !== null) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  const stop = useCallback(() => {
    clearProgressTimer();
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current.onboundary = null;
      utteranceRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsLoading(false);
    setPlayProgress(0);
    wordIndexRef.current = 0;
    wordCountRef.current = 0;
  }, []);

  const speak = useCallback(async (snippetId: number, onEnded?: () => void) => {
    if (!enabled) return;
    genRef.current += 1;
    const myGen = genRef.current;
    stop();
    setIsLoading(true);
    setPlayProgress(0);

    try {
      const text = await fetchSnippetText(snippetId);

      // Abort if a newer speak() call has already taken over
      if (genRef.current !== myGen) return;

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.92;   // slightly slower for broadcast clarity
      utterance.pitch = 1.0;
      utterance.volume = 0.85;

      // Track progress via word boundaries
      const words = text.trim().split(/\s+/).length;
      wordCountRef.current = words;
      wordIndexRef.current = 0;
      utterance.onboundary = (e) => {
        if (e.name === 'word') {
          wordIndexRef.current += 1;
          if (wordCountRef.current > 0) {
            setPlayProgress(Math.min(wordIndexRef.current / wordCountRef.current, 0.99));
          }
        }
      };

      utterance.onend = () => {
        if (utteranceRef.current !== utterance) return; // stale
        clearProgressTimer();
        utteranceRef.current = null;
        setPlayProgress(1);
        setIsLoading(false);
        if (onEnded) onEnded();
      };

      utterance.onerror = (e) => {
        if (utteranceRef.current !== utterance) return; // stale
        // 'interrupted' fires when we cancel() — not a real error, just stop()
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        clearProgressTimer();
        utteranceRef.current = null;
        console.warn('[voice] SpeechSynthesis error:', e.error);
        setIsLoading(false);
        if (onEnded) setTimeout(onEnded, 2000);
      };

      utteranceRef.current = utterance;
      setIsLoading(false);
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      if (genRef.current !== myGen) return; // stale, ignore
      console.warn('[voice] TTS error:', err);
      setIsLoading(false);
      // If text fetch or speech fails, still advance so the slideshow doesn't freeze
      if (onEnded) setTimeout(onEnded, 2000);
    }
  }, [enabled, stop]);

  // Prefetch text for a snippet in the background (no playback)
  const prefetch = useCallback((snippetId: number) => {
    if (!enabled) return;
    fetchSnippetText(snippetId).catch(() => {});
  }, [enabled]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { speak, stop, prefetch, isLoading, playProgress };
}
