/**
 * The compression run (ARCHITECTURE.md §6.3–6.4): step the rigid
 * compressor down in −Y until it carries the largest target force, with
 * one-sided, sticking contact against both the compressor and a rigid
 * floor. Each step runs an active-set loop over contact nodes.
 *
 * Contact is imposed with penalty springs on the translational dofs of
 * contact nodes (stiffness `penalty` × the dof's own diagonal), so the
 * active set only changes the diagonal: small changes are rank-1 updates
 * to one factor, large ones a refactor, whichever costs less. A penalty
 * of 1e8 holds a contact to ~1e-8 of its prescribed displacement; the
 * violation is reported.
 */
import { BlockCholesky } from './cholesky';
import { bsrMul, buildFrame, strutEndForces, type FrameInput, type FrameModel } from './model';
import { nestedDissection } from './order';

export interface SweepInput extends FrameInput {
  /** Vertical gap from each node up to the compressor, m; Infinity if never under it. */
  gaps: Float64Array;
  /** Floor height, m (the lattice's lowest point). */
  groundY: number;
  /** Ascending compressor forces to reach, N. The run stops past the last. */
  targets: number[];
}

export interface SweepOptions {
  /** Nodes this close above the floor may touch it during the run, m. */
  groundCandidate?: number;
  penalty?: number;
  maxPasses?: number;
  maxSteps?: number;
  /** Travel past first contact for the first step, m. */
  firstStep?: number;
  /**
   * Largest travel increment between steps, m. The force-travel curve
   * stiffens sharply over the first millimetre as contact spreads, so a
   * secant from the first step underestimates stiffness and would jump
   * past several targets; the slider then interpolates across a span
   * that isn't close to linear.
   */
  maxStep?: number;
  /** A contact force pulling by less than this is still contact, N. */
  tolForce?: number;
  /** A free node closer than this to a surface isn't through it, m. */
  tolGap?: number;
  /** Let a pulling stick contact slide (normal-only) before releasing it. */
  slip?: boolean;
  /**
   * Share of pulling contacts released in the first pass of a step, worst
   * first. Halved whenever a pass sees releases come back (oscillation).
   */
  releaseFraction?: number;
}

export interface StepResult {
  /** Compressor travel from the start position, m. */
  delta: number;
  /** Total compressor force, N (positive pushing down). */
  force: number;
  /** Total floor reaction, N. */
  groundForce: number;
  /** Displacements, 6 per node (m, rad). */
  u: Float64Array;
  /** Per node: 0 free, SLIP, STICK. */
  compressorContact: Uint8Array;
  groundContact: Uint8Array;
  passes: number;
  /** False if the active set was still changing at the pass cap. */
  converged: boolean;
  /** Contact nodes held at their last state by the anti-cycling rule. */
  frozen: number;
  /** ‖K u‖ on free dofs relative to the constraint forces. */
  residual: number;
  /** Largest gap between a contact node and its surface, m. */
  violation: number;
  /** Axial force per strut, N, + tension. */
  axial: Float32Array;
  /** Peak fibre strain per strut. */
  strain: Float32Array;
  ms: number;
}

export interface SweepResult {
  steps: StepResult[];
  /** Travel at which the first node touches, m. */
  firstContact: number;
  E: number;
  dof: number;
  factorBlocks: number;
  factorizations: number;
  updates: number;
  ms: number;
  warnings: string[];
}

export interface SweepHooks {
  progress?: (msg: string) => void;
  /** Called with each step as soon as it is solved. */
  step?: (s: StepResult, firstContact: number) => void;
  debug?: (msg: string) => void;
}

/** Contact states (StepResult.compressorContact / groundContact). */
export const SLIP = 1, STICK = 2;

export function runSweep(input: SweepInput, opts: SweepOptions = {}, hooks: SweepHooks = {}): SweepResult {
  const progress = hooks.progress ?? (() => {});
  const debug = hooks.debug;
  const t0 = performance.now();
  const groundCandidate = opts.groundCandidate ?? 3e-3;
  const kappa = opts.penalty ?? 1e8;
  const maxPasses = opts.maxPasses ?? 30;
  const maxSteps = opts.maxSteps ?? 24;
  const warnings: string[] = [];

  progress('assembling...');
  const model = buildFrame(input);
  const n = model.nNodes;
  const K = model.K;
  progress('ordering...');
  const chol = new BlockCholesky(K, nestedDissection(input.nodes, K));

  const gaps = input.gaps;
  const ggap = new Float64Array(n);
  for (let i = 0; i < n; i++) ggap[i] = input.nodes[3 * i + 1] - input.groundY;
  let gmin = Infinity;
  for (const g of gaps) gmin = Math.min(gmin, g);
  if (!Number.isFinite(gmin)) throw new Error('no lattice nodes under the compressor');
  const compCand: number[] = [], groundCand: number[] = [];
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(gaps[i])) compCand.push(i);
    if (ggap[i] < groundCandidate) groundCand.push(i);
  }

  const kdiag = new Float64Array(6 * n);
  for (let i = 0; i < n; i++) for (let a = 0; a < 6; a++) kdiag[6 * i + a] = K.val[K.diag[i] * 36 + a * 7];

  // Contact state per node: 0 free, 1 slip (normal constraint only),
  // 2 stick (all three translations). A stick contact that turns tensile
  // drops to slip before it is released. Under Coulomb friction a contact
  // with no normal force can't hold a tangential one, and without that
  // middle state stick contacts cycle: held sideways they pull, set free
  // they spring back through the surface (ARCHITECTURE.md §6.4).
  const stateC = new Uint8Array(n), stateG = new Uint8Array(n);
  for (const i of groundCand) if (ggap[i] <= 1e-9) stateG[i] = STICK;

  // Penalties currently inside the factor, and the ones the active set wants.
  const inFactor = new Float64Array(6 * n);
  const want = new Float64Array(6 * n);
  let factored = false, factorizations = 0, updates = 0;
  // Measured costs decide between rank-1 updates and a refactor.
  let factorMs = 0, updateMs = 0;

  const syncFactor = () => {
    want.fill(0);
    for (let i = 0; i < n; i++) {
      const st = Math.max(stateC[i], stateG[i]);
      if (st === STICK) for (let a = 0; a < 3; a++) want[6 * i + a] = kappa * kdiag[6 * i + a];
      else if (st === SLIP) want[6 * i + 1] = kappa * kdiag[6 * i + 1];
    }
    if (factored) {
      const changed: number[] = [];
      for (let d = 0; d < want.length; d++) if (want[d] !== inFactor[d]) changed.push(d);
      if (!changed.length) return;
      if (changed.length * updateMs < 0.8 * factorMs) {
        const t = performance.now();
        let ok = true;
        for (const d of changed) {
          if (!chol.rank1(d, want[d] - inFactor[d])) { ok = false; break; }
          inFactor[d] = want[d];
          updates++;
        }
        updateMs = (performance.now() - t) / changed.length;
        if (ok) return;
      }
    }
    const t = performance.now();
    if (!chol.factor(K, want)) throw new Error('stiffness is not positive definite: the lattice is not held (check the floor contact)');
    factorMs = performance.now() - t;
    // First estimate before any update has been timed: ~1/1000 of a factor
    // on the reference shoe.
    if (!updateMs) updateMs = factorMs / 1000;
    inFactor.set(want);
    factored = true;
    factorizations++;
  };

  const u = new Float64Array(6 * n), b = new Float64Array(6 * n), r = new Float64Array(6 * n);
  const tolF = opts.tolForce ?? 1e-3, tolU = opts.tolGap ?? 1e-6;
  const useSlip = opts.slip ?? false;
  const reenter = useSlip ? SLIP : STICK;
  const releaseStart = opts.releaseFraction ?? 1;
  let lastDelta = -Infinity;
  let lastU: Float64Array | null = null;

  const solveAt = (delta: number): Omit<StepResult, 'axial' | 'strain' | 'ms'> & { u: Float64Array } => {
    const flips = new Uint8Array(n);
    let passes = 0, converged = false, frozen = 0;
    let releaseFraction = releaseStart, lastReleased = 0;
    if (!lastU) {
      // First step: every node whose gap has closed starts stuck.
      for (const i of compCand) if (gaps[i] < delta) stateC[i] = STICK;
    } else {
      // Later steps: predict the free displacements by scaling the last
      // solution with the travel past first contact, and start with the
      // nodes the prediction puts through either surface. Starting from
      // every closed gap instead costs several refactors per step.
      const scale = (delta - gmin) / Math.max(1e-12, lastDelta - gmin);
      for (const i of compCand) {
        if (!stateC[i] && lastU[6 * i + 1] * scale > -(delta - gaps[i])) stateC[i] = STICK;
      }
      for (const i of groundCand) {
        if (!stateG[i] && !stateC[i] && lastU[6 * i + 1] * scale < -ggap[i]) stateG[i] = STICK;
      }
    }
    lastDelta = delta;
    for (;;) {
      passes++;
      syncFactor();
      b.fill(0);
      for (let i = 0; i < n; i++) {
        if (stateC[i]) b[6 * i + 1] = inFactor[6 * i + 1] * -(delta - gaps[i]);
        else if (stateG[i]) b[6 * i + 1] = inFactor[6 * i + 1] * -ggap[i];
      }
      chol.solve(b, u);
      bsrMul(K, u, r);

      let changed = 0, reentered = 0;
      frozen = 0;
      const set = (arr: Uint8Array, i: number, v: number) => {
        // Anti-cycling: a node that has changed state three times this
        // step keeps its state, and the step is reported unconverged.
        if (flips[i] >= 3) { frozen++; return; }
        arr[i] = v; flips[i]++; changed++;
      };
      // Releases: contacts that pull. Only the worst quarter go each pass:
      // neighbouring contacts share load, so releasing all at once
      // overshoots and the set oscillates. Penetrations are all added.
      const pulling: [number, number, Uint8Array][] = [];
      for (const i of compCand) {
        const st = stateC[i];
        // r is the constraint force on the node; the compressor only pushes down.
        if (st && r[6 * i + 1] > tolF) { if (flips[i] < 3) pulling.push([r[6 * i + 1], i, stateC]); else frozen++; }
        else if (!st && u[6 * i + 1] > -(delta - gaps[i]) + tolU) { set(stateC, i, reenter); reentered++; }
      }
      for (const i of groundCand) {
        if (stateC[i]) continue;
        const st = stateG[i];
        // The floor only pushes up.
        if (st && r[6 * i + 1] < -tolF) { if (flips[i] < 3) pulling.push([-r[6 * i + 1], i, stateG]); else frozen++; }
        else if (!st && u[6 * i + 1] < -ggap[i] - tolU) { set(stateG, i, reenter); reentered++; }
      }
      pulling.sort((x, y) => y[0] - x[0]);
      // Oscillation: a good share of last pass's releases came back.
      if (lastReleased && reentered > 0.1 * lastReleased) releaseFraction = Math.max(0.125, releaseFraction / 2);
      else if (lastReleased && reentered < 0.02 * lastReleased) releaseFraction = Math.min(1, releaseFraction * 2);
      const release = Math.max(5, Math.ceil(pulling.length * releaseFraction));
      lastReleased = Math.min(release, pulling.length);
      for (let k = 0; k < pulling.length; k++) {
        const [, i, arr] = pulling[k];
        if (k < release) set(arr, i, useSlip ? arr[i] - 1 : 0);
        else changed++; // still pulling: not converged yet
      }
      debug?.(`pass ${passes}: pulling ${pulling.length}, released ${lastReleased}, re-entered ${reentered}, changed ${changed}, frozen ${frozen}`);
      if (!changed) { converged = true; break; }
      if (passes >= maxPasses) break;
    }

    let force = 0, groundForce = 0, violation = 0, rc = 0, rf = 0;
    const isCon = new Uint8Array(6 * n);
    for (let i = 0; i < n; i++) {
      if (stateC[i]) {
        force -= r[6 * i + 1];
        violation = Math.max(violation, Math.abs(u[6 * i + 1] + (delta - gaps[i])));
      } else if (stateG[i]) {
        groundForce += r[6 * i + 1];
        violation = Math.max(violation, Math.abs(u[6 * i + 1] + ggap[i]));
      }
      const st = Math.max(stateC[i], stateG[i]);
      if (st === STICK) for (let a = 0; a < 3; a++) isCon[6 * i + a] = 1;
      else if (st === SLIP) isCon[6 * i + 1] = 1;
    }
    for (let d = 0; d < 6 * n; d++) {
      if (isCon[d]) rc += r[d] * r[d]; else rf += r[d] * r[d];
    }
    lastU = u.slice();
    return {
      delta, force, groundForce, u: lastU, compressorContact: stateC.slice(), groundContact: stateG.slice(),
      passes, converged, frozen, residual: rc > 0 ? Math.sqrt(rf / rc) : 0, violation,
    };
  };

  const steps: StepResult[] = [];
  const targets = [...input.targets].sort((a, b) => a - b);
  const Fmax = targets[targets.length - 1];
  let delta = gmin + (opts.firstStep ?? 0.3e-3);
  let prev = { delta: gmin, force: 0 };
  while (steps.length < maxSteps) {
    const ts = performance.now();
    progress(`solving step ${steps.length + 1}: travel ${((delta - gmin) * 1e3).toFixed(2)} mm past contact...`);
    const s = solveAt(delta);
    const { axial, strain } = recover(model, s.u);
    steps.push({ ...s, axial, strain, ms: performance.now() - ts });
    hooks.step?.(steps[steps.length - 1], gmin);
    const contacts = s.compressorContact.filter((v) => v > 0).length + s.groundContact.filter((v) => v > 0).length;
    if (!s.converged) warnings.push(`step ${steps.length}: contact still changing after ${s.passes} passes`);
    else if (s.frozen > 0.01 * contacts) warnings.push(`step ${steps.length}: ${s.frozen} contact nodes held by the anti-cycling rule`);
    if (s.force >= Fmax * 0.999) break;
    // Secant on the force-travel curve toward the next target. The curve
    // stiffens as contact spreads, so this tends to overshoot slightly,
    // which is the safe side for bracketing.
    const k = (s.force - prev.force) / Math.max(1e-9, s.delta - prev.delta);
    const next = targets.find((t) => t > s.force * 1.02) ?? Fmax;
    let d = k > 0 ? (next - s.force) / k : 0.25e-3;
    d = Math.min(opts.maxStep ?? 0.3e-3, Math.max(0.02e-3, d));
    prev = { delta: s.delta, force: s.force };
    delta = s.delta + d;
  }
  if (steps[steps.length - 1].force < Fmax * 0.999) warnings.push(`stopped after ${steps.length} steps below the target force`);

  return {
    steps,
    firstContact: gmin,
    E: input.E,
    dof: 6 * n,
    factorBlocks: chol.blocks,
    factorizations,
    updates,
    ms: performance.now() - t0,
    warnings,
  };
}

/**
 * Strut axial force and peak fibre strain: the largest of |N|/A + M/Z at
 * either end, over E. M is the resultant bending moment.
 */
export function recover(model: FrameModel, u: Float64Array): { axial: Float32Array; strain: Float32Array } {
  const m = model.lengths.length;
  const axial = new Float32Array(m), strain = new Float32Array(m);
  const f = new Float64Array(12), k = new Float64Array(144);
  for (let s = 0; s < m; s++) {
    strutEndForces(model, s, u, f, k);
    const sec = model.sections[model.input.strutSection[s]];
    // Local force on end j along x is +N in tension.
    const N = f[6];
    const Mi = Math.hypot(f[4], f[5]), Mj = Math.hypot(f[10], f[11]);
    axial[s] = N;
    strain[s] = (Math.abs(N) / sec.A + Math.max(Mi, Mj) / sec.Z) / sec.E;
  }
  return { axial, strain };
}
