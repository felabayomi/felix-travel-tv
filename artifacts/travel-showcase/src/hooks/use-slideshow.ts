import { useState, useEffect } from 'react';
import type { Slide } from '@workspace/api-client-react/src/generated/api.schemas';

export function useSlideshow(slides: Slide[], intervalMs: number = 10000) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Ensure index stays in bounds if slides are deleted
  useEffect(() => {
    if (slides.length > 0 && currentIndex >= slides.length) {
      setCurrentIndex(0);
    }
  }, [slides.length, currentIndex]);

  // Auto-advance logic
  useEffect(() => {
    if (slides.length <= 1 || isPaused) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % slides.length);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [slides.length, intervalMs, isPaused]);

  const next = () => setCurrentIndex((prev) => (prev + 1) % slides.length);
  const prev = () => setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
  const goTo = (index: number) => {
    if (index >= 0 && index < slides.length) {
      setCurrentIndex(index);
    }
  };

  return {
    currentIndex,
    currentSlide: slides[currentIndex] || null,
    next,
    prev,
    goTo,
    isPaused,
    setIsPaused,
    intervalMs
  };
}
