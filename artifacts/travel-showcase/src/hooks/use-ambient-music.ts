import { useRef, useState, useCallback, useEffect } from 'react';

// Cinematic ambient music generator using the Web Audio API.
// All sound is synthesized — no samples, no copyright issues.

// A-minor pentatonic chord frequencies (A2, C3, E3, G3, A3) for a cinematic mood
const CHORD_SETS = [
  [110.00, 130.81, 164.81, 196.00, 220.00], // Am
  [98.00,  116.54, 146.83, 174.61, 196.00], // Gm
  [123.47, 146.83, 185.00, 220.00, 246.94], // Bm
  [110.00, 138.59, 164.81, 207.65, 220.00], // Am/C#
];

export function useAmbientMusic() {
  const [isPlaying, setIsPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const activeNodesRef = useRef<AudioNode[]>([]);
  const chordIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chordIndexRef = useRef(0);

  const createReverb = useCallback((ctx: AudioContext): ConvolverNode => {
    const convolver = ctx.createConvolver();
    const rate = ctx.sampleRate;
    const length = rate * 3.5;
    const impulse = ctx.createBuffer(2, length, rate);
    for (let c = 0; c < 2; c++) {
      const data = impulse.getChannelData(c);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }
    convolver.buffer = impulse;
    return convolver;
  }, []);

  const playChord = useCallback((
    ctx: AudioContext,
    masterGain: GainNode,
    reverb: ConvolverNode,
    frequencies: number[],
  ) => {
    const now = ctx.currentTime;
    const chordGain = ctx.createGain();
    chordGain.gain.setValueAtTime(0, now);
    chordGain.gain.linearRampToValueAtTime(0.18, now + 3.5);
    chordGain.gain.linearRampToValueAtTime(0.12, now + 8);
    chordGain.gain.linearRampToValueAtTime(0, now + 14);
    chordGain.connect(reverb);
    chordGain.connect(masterGain);
    activeNodesRef.current.push(chordGain);

    frequencies.forEach((freq, i) => {
      // Main oscillator — sine for warmth
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      // Slight detune per voice for richness
      const detune = (i % 2 === 0 ? 1 : -1) * (3 + i * 1.2);
      osc.detune.setValueAtTime(detune, now);

      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(1 / frequencies.length, now);
      osc.connect(oscGain);
      oscGain.connect(chordGain);
      osc.start(now);
      osc.stop(now + 16);
      activeNodesRef.current.push(osc, oscGain);

      // Second oscillator one octave up, very subtle
      if (i < 2) {
        const osc2 = ctx.createOscillator();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2, now);
        osc2.detune.setValueAtTime(-detune, now);
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.setValueAtTime(0.08 / frequencies.length, now);
        osc2.connect(osc2Gain);
        osc2Gain.connect(chordGain);
        osc2.start(now);
        osc2.stop(now + 16);
        activeNodesRef.current.push(osc2, osc2Gain);
      }
    });
  }, []);

  const playDrone = useCallback((
    ctx: AudioContext,
    masterGain: GainNode,
    reverb: ConvolverNode,
  ) => {
    // Persistent deep bass drone on A1 (55 Hz)
    const now = ctx.currentTime;
    const droneGain = ctx.createGain();
    droneGain.gain.setValueAtTime(0, now);
    droneGain.gain.linearRampToValueAtTime(0.08, now + 5);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, now);

    // Slow LFO on filter cutoff for movement
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(0.08, now);
    const lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(60, now);
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(now);

    [55, 55.3, 82.5].forEach((freq) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      osc.connect(filter);
      osc.start(now);
      activeNodesRef.current.push(osc);
    });

    filter.connect(droneGain);
    droneGain.connect(reverb);
    droneGain.connect(masterGain);
    activeNodesRef.current.push(filter, droneGain, lfo, lfoGain);
  }, []);

  const playShimmer = useCallback((
    ctx: AudioContext,
    masterGain: GainNode,
  ) => {
    // Subtle high-frequency shimmer (very quiet)
    const now = ctx.currentTime;
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.setValueAtTime(0.018, now);

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(3000, now);

    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(filter);
    filter.connect(shimmerGain);
    shimmerGain.connect(masterGain);
    source.start(now);
    activeNodesRef.current.push(source, filter, shimmerGain);
  }, []);

  const start = useCallback(async () => {
    if (ctxRef.current) return;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.7, ctx.currentTime + 4);
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    const reverb = createReverb(ctx);
    const reverbGain = ctx.createGain();
    reverbGain.gain.setValueAtTime(0.45, ctx.currentTime);
    reverb.connect(reverbGain);
    reverbGain.connect(ctx.destination);
    activeNodesRef.current.push(reverb, reverbGain);

    playDrone(ctx, masterGain, reverb);
    playShimmer(ctx, masterGain);
    playChord(ctx, masterGain, reverb, CHORD_SETS[0]);

    // Rotate through chord sets every 12 seconds
    chordIntervalRef.current = setInterval(() => {
      chordIndexRef.current = (chordIndexRef.current + 1) % CHORD_SETS.length;
      if (ctxRef.current && masterGainRef.current) {
        playChord(ctxRef.current, masterGainRef.current, reverb, CHORD_SETS[chordIndexRef.current]);
      }
    }, 12000);

    setIsPlaying(true);
  }, [createReverb, playDrone, playShimmer, playChord]);

  const stop = useCallback(() => {
    if (chordIntervalRef.current) {
      clearInterval(chordIntervalRef.current);
      chordIntervalRef.current = null;
    }
    if (masterGainRef.current && ctxRef.current) {
      masterGainRef.current.gain.linearRampToValueAtTime(0, ctxRef.current.currentTime + 2);
    }
    setTimeout(() => {
      activeNodesRef.current.forEach(node => {
        try { (node as AudioScheduledSourceNode).stop?.(); } catch {}
      });
      activeNodesRef.current = [];
      ctxRef.current?.close();
      ctxRef.current = null;
      masterGainRef.current = null;
      chordIndexRef.current = 0;
    }, 2200);
    setIsPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) stop();
    else start();
  }, [isPlaying, start, stop]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (chordIntervalRef.current) clearInterval(chordIntervalRef.current);
      ctxRef.current?.close();
    };
  }, []);

  return { isPlaying, toggle };
}
