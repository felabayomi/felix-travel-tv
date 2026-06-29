import { useEffect, useRef } from 'react';

type ItemType = 'article' | 'video' | 'interlude' | null;

interface SnippetLike {
  id: number;
}

interface LiveState {
  playingArticleId: number | null;
  currentSnippetIndex: number;
  snippets: SnippetLike[];
  queueAutoplay: boolean;
  serverItemType: ItemType;
}

interface UseNewsClipControllerOptions {
  voiceEnabled: boolean;
  queueAutoplay: boolean;
  playingArticleId: number | null;
  currentSnippetIndex: number;
  snippets: SnippetLike[];
  serverItemType: ItemType;
  voiceRestartToken: number;
  autoPlaySeconds: number;
  voiceFallbackSeconds: number;
  speak: (snippetId: number, onEnded?: () => void) => void;
  onAdvance: () => void;
  getLiveState: () => LiveState;
}

// Single-purpose deterministic controller for clip narration + progression.
// Rules:
// 1) Speak exactly one clip at a time.
// 2) Reject stale onEnded callbacks.
// 3) Advance monotonically via onAdvance only when the same clip is still current.
// 4) Keep one fallback timer per clip; never stack timers.
export function useNewsClipController(options: UseNewsClipControllerOptions) {
  const {
    voiceEnabled,
    queueAutoplay,
    playingArticleId,
    currentSnippetIndex,
    snippets,
    serverItemType,
    voiceRestartToken,
    autoPlaySeconds,
    voiceFallbackSeconds,
    speak,
    onAdvance,
    getLiveState,
  } = options;

  const speakRef = useRef(speak);
  const onAdvanceRef = useRef(onAdvance);
  const getLiveStateRef = useRef(getLiveState);
  const runTokenRef = useRef(0);
  const lastStartedKeyRef = useRef<string | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { speakRef.current = speak; }, [speak]);
  useEffect(() => { onAdvanceRef.current = onAdvance; }, [onAdvance]);
  useEffect(() => { getLiveStateRef.current = getLiveState; }, [getLiveState]);

  useEffect(() => {
    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
      runTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    if (serverItemType === 'interlude' || !playingArticleId) {
      runTokenRef.current += 1;
      lastStartedKeyRef.current = null;
      return;
    }

    const snippet = snippets[currentSnippetIndex];
    if (!snippet) return;

    const clipKey = `${playingArticleId}:${currentSnippetIndex}:${snippet.id}:r${voiceRestartToken}:v${voiceEnabled ? 1 : 0}`;

    if (voiceEnabled && lastStartedKeyRef.current !== clipKey) {
      lastStartedKeyRef.current = clipKey;
      runTokenRef.current += 1;
      const myToken = runTokenRef.current;
      const startedArticleId = playingArticleId;
      const startedIndex = currentSnippetIndex;
      const startedSnippetId = snippet.id;

      speakRef.current(startedSnippetId, () => {
        if (myToken !== runTokenRef.current) return;

        const live = getLiveStateRef.current();
        const liveSnippetId = live.snippets[live.currentSnippetIndex]?.id;
        const isSameArticle = live.playingArticleId === startedArticleId;
        const isSameIndex = live.currentSnippetIndex === startedIndex;
        const isSameSnippet = liveSnippetId === startedSnippetId;
        const canAdvance = live.queueAutoplay && live.serverItemType !== 'interlude';

        if (isSameArticle && isSameIndex && isSameSnippet && canAdvance) {
          onAdvanceRef.current();
        }
      });
    }

    if (!queueAutoplay) return;

    const timerToken = runTokenRef.current;
    const timerArticleId = playingArticleId;
    const timerIndex = currentSnippetIndex;
    const timerSnippetId = snippet.id;
    const delayMs = (voiceEnabled ? voiceFallbackSeconds : autoPlaySeconds) * 1000;

    fallbackTimerRef.current = setTimeout(() => {
      if (timerToken !== runTokenRef.current) return;
      const live = getLiveStateRef.current();
      const liveSnippetId = live.snippets[live.currentSnippetIndex]?.id;
      const isSameArticle = live.playingArticleId === timerArticleId;
      const isSameIndex = live.currentSnippetIndex === timerIndex;
      const isSameSnippet = liveSnippetId === timerSnippetId;
      const canAdvance = live.queueAutoplay && live.serverItemType !== 'interlude';

      if (isSameArticle && isSameIndex && isSameSnippet && canAdvance) {
        onAdvanceRef.current();
      }
    }, delayMs);

    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [
    voiceEnabled,
    queueAutoplay,
    playingArticleId,
    currentSnippetIndex,
    snippets,
    serverItemType,
    voiceRestartToken,
    autoPlaySeconds,
    voiceFallbackSeconds,
  ]);
}
