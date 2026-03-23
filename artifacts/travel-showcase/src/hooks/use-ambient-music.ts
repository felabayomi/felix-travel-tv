import { useRef, useState, useCallback, useEffect } from 'react';

// Cinematic ambient music — pure sine/triangle oscillators only.
// Sounds like a soft piano/synth ambient piece. No noise, no static.

// C pentatonic scale (C, D, E, G, A) across two octaves — always sounds pleasant
const MELODY_NOTES = [
  261.63, // C4
  293.66, // D4
  329.63, // E4
  392.00, // G4
  440.00, // A4
  523.25, // C5
  587.33, // D5
  659.25, // E5
];

// Gentle pad chords in C major / Am feel
const PAD_CHORDS: number[][] = [
  [130.81, 196.00, 261.63, 329.63], // C - G - C5 - E5
  [110.00, 164.81, 220.00, 293.66], // A - E - A4 - D5
  [98.00,  146.83, 196.00, 261.63], // G - D - G4 - C5
  [123.47, 185.00, 246.94, 329.63], // B - F# - B4 - E5
];

function createSoftEnvelope(
  ctx: AudioContext,
  gainNode: GainNode,
  attackTime: number,
  sustainLevel: number,
  releaseTime: number,
  totalDuration: number,
) {
  const now = ctx.currentTime;
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(sustainLevel, now + attackTime);
  gainNode.gain.setValueAtTime(sustainLevel, now + totalDuration - releaseTime);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + totalDuration);
}

export function useAmbientMusic() {
  const [isPlaying, setIsPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const schedulerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chordIndexRef = useRef(0);
  const melodyIndexRef = useRef(0);

  // Simple delay line for a sense of space (no convolver/noise)
  const createDelay = useCallback((ctx: AudioContext, masterGain: GainNode) => {
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.38;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const delayGain = ctx.createGain();
    delayGain.gain.value = 0.22;

    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(masterGain);

    return delay;
  }, []);

  const playPadNote = useCallback((
    ctx: AudioContext,
    destination: AudioNode,
    frequency: number,
    startOffset: number,
    duration: number,
    level: number,
  ) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;

    // Tiny second oscillator for warmth (+7 cents detune)
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = frequency;
    osc2.detune.value = 7;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(destination);

    const startTime = ctx.currentTime + startOffset;
    osc.start(startTime);
    osc2.start(startTime);

    const attackTime = 2.5;
    const releaseTime = 3.0;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(level, startTime + attackTime);
    gain.gain.setValueAtTime(level, startTime + duration - releaseTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.stop(startTime + duration + 0.1);
    osc2.stop(startTime + duration + 0.1);
  }, []);

  const playMelodyNote = useCallback((
    ctx: AudioContext,
    destination: AudioNode,
    frequency: number,
    startOffset: number,
  ) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;

    const gain = ctx.createGain();
    const duration = 4.5;
    const startTime = ctx.currentTime + startOffset;

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.09, startTime + 0.06); // quick soft attack like a piano key
    gain.gain.exponentialRampToValueAtTime(0.055, startTime + 0.8);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.1);
  }, []);

  const scheduleChunk = useCallback(() => {
    const ctx = ctxRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx || !masterGain) return;

    const delayRef = (masterGainRef as any)._delay as AudioNode | undefined;
    const dest = delayRef ?? masterGain;

    // Play 4-note pad chord — stagger each note slightly for a bloom feel
    const chord = PAD_CHORDS[chordIndexRef.current % PAD_CHORDS.length];
    chord.forEach((freq, i) => {
      playPadNote(ctx, dest, freq, i * 0.3, 16, 0.055);
    });
    chordIndexRef.current++;

    // Play 3-4 melody notes spread across the 16-second window
    const numNotes = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < numNotes; i++) {
      const offset = 2 + i * (12 / numNotes) + Math.random() * 1.5;
      const noteFreq = MELODY_NOTES[melodyIndexRef.current % MELODY_NOTES.length];
      melodyIndexRef.current += Math.floor(Math.random() * 3) + 1;
      playMelodyNote(ctx, dest, noteFreq, offset);
    }

    // Schedule next chunk to overlap slightly (at 14s so next chord blooms before this ends)
    schedulerRef.current = setTimeout(scheduleChunk, 14000);
  }, [playPadNote, playMelodyNote]);

  const start = useCallback(async () => {
    if (ctxRef.current) return;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    masterGain.gain.exponentialRampToValueAtTime(0.85, ctx.currentTime + 3);
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    // Attach delay to the gain ref so scheduleChunk can access it
    const delay = createDelay(ctx, masterGain);
    (masterGainRef as any)._delay = delay;

    scheduleChunk();
    setIsPlaying(true);
  }, [createDelay, scheduleChunk]);

  const stop = useCallback(() => {
    if (schedulerRef.current) {
      clearTimeout(schedulerRef.current);
      schedulerRef.current = null;
    }
    if (masterGainRef.current && ctxRef.current) {
      const now = ctxRef.current.currentTime;
      masterGainRef.current.gain.setValueAtTime(masterGainRef.current.gain.value, now);
      masterGainRef.current.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
    }
    setTimeout(() => {
      ctxRef.current?.close();
      ctxRef.current = null;
      masterGainRef.current = null;
      chordIndexRef.current = 0;
      melodyIndexRef.current = 0;
    }, 2700);
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) stop();
    else start();
  }, [isPlaying, start, stop]);

  useEffect(() => {
    return () => {
      if (schedulerRef.current) clearTimeout(schedulerRef.current);
      ctxRef.current?.close();
    };
  }, []);

  return { isPlaying, toggle };
}
