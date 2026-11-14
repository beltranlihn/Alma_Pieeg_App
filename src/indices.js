// The "mind" indices PiEEG's experiences use. They are band-power ratios, nothing more: focus rises
// with facial muscle tension, alpha rises when the eyes close. We compute them exactly as they do
// and normalise each one against the person's own last minute (5th–95th percentile → 0–1), so the
// meters move the same way their games do. Honest names in the UI: "ratio", not "attention".
export const INDICES = [
  { id: 'focus', label: 'Focus', formula: '(β + γ) / (α + θ + δ)', source: 'PiEEG useFocus' },
  { id: 'relax', label: 'Relax', formula: 'α / total + θ / β (composite)', source: 'PiEEG useRelax' },
  { id: 'calm', label: 'Calm', formula: 'α / (α + β)', source: 'PiEEG Stoic / Glitching Reality' },
  { id: 'engagement', label: 'Engagement', formula: 'β / (α + θ)', source: 'PiEEG Chrome, Unity' },
  { id: 'workload', label: 'Workload', formula: 'θ / α', source: 'PiEEG Chrome' },
  { id: 'fatigue', label: 'Fatigue', formula: '(θ + α) / β', source: 'PiEEG Chrome' },
  { id: 'meditation', label: 'Meditation', formula: '(θ + α) / total', source: 'pieeg.js' },
];

export function rawIndices(b) {
  const e = 1e-9, { delta: d, theta: t, alpha: a, beta: be, gamma: g, total } = b;
  return {
    focus: (be + g) / (a + t + d + e),
    relax: 0.5 * (a / (total + e)) + 0.5 * Math.min(1, (t / (be + e)) / 3),
    calm: a / (a + be + e),
    engagement: be / (a + t + e),
    workload: t / (a + e),
    fatigue: (t + a) / (be + e),
    meditation: (t + a) / (total + e),
  };
}

/** Rolling percentile normaliser: value → 0–1 against the last `seconds` of that value. */
export class RollingNorm {
  constructor(seconds = 60, hz = 10) { this.max = seconds * hz; this.hist = []; }
  reset() { this.hist = []; }
  push(v) {
    this.hist.push(v); if (this.hist.length > this.max) this.hist.shift();
    if (this.hist.length < 20) return 0.5;
    const s = [...this.hist].sort((x, y) => x - y);
    const lo = s[Math.floor(s.length * 0.05)], hi = s[Math.floor(s.length * 0.95)];
    return hi - lo > 1e-9 ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5;
  }
}
