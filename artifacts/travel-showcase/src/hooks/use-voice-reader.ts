import { useEffect, useRef, useCallback } from 'react';

export function useVoiceReader(enabled: boolean) {
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      activeUtteranceRef.current = null;
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (!enabled || typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v =>
      v.lang.startsWith('en') && (v.name.toLowerCase().includes('natural') || v.name.toLowerCase().includes('samantha') || v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('daniel'))
    ) || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;
    activeUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => {
    return () => { stop(); };
  }, [stop]);

  return { speak, stop };
}
