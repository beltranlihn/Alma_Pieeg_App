// Short sine tones for protocol cues (calibration, gestures, gaze, tension), so the person can follow with
// the eyes closed or inside a headset. The first call happens on a click, which unlocks the audio context.
let ctx = null;
export function tone(freq, ms = 140, delay = 0) {
  try {
    ctx = ctx || new AudioContext();
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.start(t); o.stop(t + ms / 1000 + 0.02);
  } catch { /* no audio device: the cue on screen still shows the phase */ }
}
export const cues = {
  start: () => tone(440, 90),
  rest: () => tone(523),
  go: () => { tone(659); tone(659, 140, 0.22); },
  move: () => tone(587, 80),
  done: () => { tone(784, 180); tone(1047, 260, 0.2); },
};
