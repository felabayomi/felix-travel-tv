import { useEffect, useRef, useCallback } from 'react';

export function useVoiceReader(enabled: boolean, onEnd?: () => void) {
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (!enabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    // Pick best available English voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      v.lang.startsWith('en') && (
        v.name.toLowerCase().includes('natural') ||
        v.name.toLowerCase().includes('samantha') ||
        v.name.toLowerCase().includes('google') ||
        v.name.toLowerCase().includes('daniel')
      )
    ) || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;

    utterance.onend = () => {
      onEndRef.current?.();
    };

    utterance.onerror = () => {
      // Still advance on error so the show doesn't get stuck
      onEndRef.current?.();
    };

    window.speechSynthesis.speak(utterance);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  // Chrome bug: speechSynthesis pauses after ~15s in background tabs.
  // Keep it alive with a periodic resume.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    }, 5000);
    return () => clearInterval(id);
  }, [enabled]);

  return { speak, stop };
}
