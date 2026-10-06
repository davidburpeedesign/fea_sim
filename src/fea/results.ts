/**
 * From solved steps to what the slider shows. The run stores a handful of
 * solved states; the slider picks a force, and the state there is
 * interpolated linearly between the two solved steps around it (the
 * unloaded state at first contact counts as step 0).
 *
 * Changing material doesn't need a re-solve: K ∝ E (ν fixed), so for a
 * given travel the displacements, contact set and strains are the same
 * and every force scales with E. The view rescales by E_now / E_run.
 */
import type { StepResult } from './solve';

/** What viewAt needs about the run: its modulus and first-contact travel. */
export interface RunMeta {
  E: number;
  firstContact: number;
}

export interface ResultView {
  /** Compressor force shown, N (after the E rescale). */
  force: number;
  /** Compressor travel from the start position, m. */
  delta: number;
  firstContact: number;
  u: Float64Array;
  strain: Float32Array;
  /** Axial force, N, + tension (after the E rescale). */
  axial: Float32Array;
  /** Nearest solved step, for contact sets and solver figures. */
  nearest: StepResult;
  /** Solved steps either side (index into steps, −1 = unloaded). */
  between: [number, number];
  /** Target beyond the last solved step: showing that step instead. */
  clamped: boolean;
  /** Tangent stiffness between the two steps either side, N/m. */
  stiffness: number;
}

export function viewAt(res: RunMeta, steps: StepResult[], target: number, E: number): ResultView | null {
  if (!steps.length) return null;
  const scale = E / res.E;
  const F = target / scale;
  const at = (i: number) => (i < 0 ? { force: 0, delta: res.firstContact } : steps[i]);
  let hi = steps.findIndex((s) => s.force >= F);
  const clamped = hi < 0;
  if (clamped) hi = steps.length - 1;
  const lo = hi - 1;
  const a = at(lo), b = at(hi);
  const t = clamped ? 1 : Math.max(0, Math.min(1, (F - a.force) / Math.max(1e-12, b.force - a.force)));
  const sb = steps[hi], sa = lo >= 0 ? steps[lo] : null;
  const lerp = <T extends Float64Array | Float32Array>(out: T, x: T | null, y: T, k = 1) => {
    for (let i = 0; i < out.length; i++) out[i] = ((x ? x[i] : 0) * (1 - t) + y[i] * t) * k;
    return out;
  };
  return {
    force: (a.force * (1 - t) + b.force * t) * scale,
    delta: a.delta * (1 - t) + b.delta * t,
    firstContact: res.firstContact,
    u: lerp(new Float64Array(sb.u.length), sa?.u ?? null, sb.u),
    strain: lerp(new Float32Array(sb.strain.length), sa?.strain ?? null, sb.strain),
    axial: lerp(new Float32Array(sb.axial.length), sa?.axial ?? null, sb.axial, scale),
    nearest: t < 0.5 && sa ? sa : sb,
    between: [lo, hi],
    clamped,
    stiffness: ((b.force - a.force) / Math.max(1e-12, b.delta - a.delta)) * scale,
  };
}

/** |u| (translations) per node, m. */
export function displacementMagnitude(u: Float64Array): Float32Array {
  const n = u.length / 6;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.hypot(u[6 * i], u[6 * i + 1], u[6 * i + 2]);
  return out;
}

export function quantile(v: ArrayLike<number>, q: number): number {
  if (!v.length) return NaN;
  const s = Float64Array.from(v as ArrayLike<number>).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export interface GroupStrain {
  group: string;
  struts: number;
  peak: number;
  p99: number;
  over: number;
}

export function strainByGroup(strain: Float32Array, strutGroup: Uint16Array, groups: string[], limit: number): GroupStrain[] {
  return groups.map((g, gi) => {
    const v: number[] = [];
    strutGroup.forEach((sg, s) => { if (sg === gi) v.push(strain[s]); });
    let peak = 0, over = 0;
    for (const x of v) { if (x > peak) peak = x; if (x > limit) over++; }
    return { group: g, struts: v.length, peak, p99: quantile(v, 0.99), over };
  });
}
