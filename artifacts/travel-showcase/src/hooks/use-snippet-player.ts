import { useState, useEffect, useRef } from 'react';
import type { Snippet } from '@workspace/api-client-react/src/generated/api.schemas';

export function useSnippetPlayer(snippets: Snippet[], intervalMs: number = 12000) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const snippetKey = snippets.map(s => s.id).join(',');
  const prevKeyRef = useRef(snippetKey);

  useEffect(() => {
    if (prevKeyRef.current !== snippetKey) {
      setCurrentIndex(0);
      prevKeyRef.current = snippetKey;
    }
  }, [snippetKey]);

  useEffect(() => {
    if (snippets.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % snippets.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [snippets.length, snippetKey, intervalMs]);

  const next = () => {
    if (snippets.length === 0) return;
    setCurrentIndex(prev => (prev + 1) % snippets.length);
  };

  const prev = () => {
    if (snippets.length === 0) return;
    setCurrentIndex(prev => (prev - 1 + snippets.length) % snippets.length);
  };

  const goTo = (index: number) => {
    if (index >= 0 && index < snippets.length) {
      setCurrentIndex(index);
    }
  };

  return {
    currentIndex,
    currentSnippet: snippets[currentIndex] || null,
    next,
    prev,
    goTo,
  };
}
