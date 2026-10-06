import { describe, expect, it } from 'vitest';
import { circleSection } from '../src/fea/element';
import { buildFrame, bsrMul, type FrameInput } from '../src/fea/model';
import { BlockCholesky } from '../src/fea/cholesky';
import { nestedDissection } from '../src/fea/order';
import { recover, runSweep } from '../src/fea/solve';

const E = 15e6, nu = 0.49, d = 1.5e-3;
const sec = circleSection(d, E, nu);

function frame(points: number[][], struts: number[][]): FrameInput {
  return {
    nodes: Float64Array.from(points.flat()),
    struts: Uint32Array.from(struts.flat()),
    strutSection: new Uint16Array(struts.length),
    diameters: Float64Array.of(d),
    E,
    nu,
  };
}

/**
 * Solve K u = f with the listed dofs fixed, through BlockCholesky with a
 * stiff diagonal penalty on fixed dofs. Returns u.
 */
function solveFixed(input: FrameInput, fixed: number[], f: Float64Array): Float64Array {
  const m = buildFrame(input);
  const chol = new BlockCholesky(m.K, nestedDissection(input.nodes, m.K));
  const add = new Float64Array(f.length);
  for (const dof of fixed) add[dof] = 1e12 * m.K.val[m.K.diag[Math.floor(dof / 6)] * 36 + (dof % 6) * 7];
  expect(chol.factor(m.K, add)).toBe(true);
  return chol.solve(f);
}

const all = (node: number) => [0, 1, 2, 3, 4, 5].map((a) => node * 6 + a);
const near = (a: number, b: number, rel = 1e-3) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(rel);

describe('timoshenko frame element', () => {
  const L = 6e-3, P = 0.1, T = 1e-4;
  const tip = PL3(L);
  function PL3(len: number) {
    return (P * len ** 3) / (3 * E * sec.I) + (P * len) / (sec.kappa * sec.G * sec.A);
  }

  it('cantilever tip deflection = PL³/3EI + PL/κGA, axial PL/EA, torsion TL/GJ', () => {
    const input = frame([[0, 0, 0], [L, 0, 0]], [[0, 1]]);
    const f = new Float64Array(12);
    f[6 + 1] = P; f[6 + 2] = P; f[6 + 0] = P; f[6 + 3] = T;
    const u = solveFixed(input, all(0), f);
    near(u[7], tip);
    near(u[8], tip);
    near(u[6], (P * L) / (E * sec.A));
    near(u[9], (T * L) / (sec.G * sec.J));
  });

  it('gives the same tip deflection for a strut at an arbitrary angle', () => {
    const dir = [1, 2, -3].map((v) => v / Math.hypot(1, 2, 3));
    const input = frame([[0, 0, 0], dir.map((v) => v * L)], [[0, 1]]);
    // A load perpendicular to the strut.
    const nrm = [2, -1, 0].map((v) => v / Math.sqrt(5));
    const f = new Float64Array(12);
    for (let k = 0; k < 3; k++) f[6 + k] = P * nrm[k];
    const u = solveFixed(input, all(0), f);
    near(u[6] * nrm[0] + u[7] * nrm[1] + u[8] * nrm[2], tip);
  });

  it('a strut split into four elements matches one element', () => {
    const pts = [0, 1, 2, 3, 4].map((i) => [(i * L) / 4, 0, 0]);
    const input = frame(pts, [[0, 1], [1, 2], [2, 3], [3, 4]]);
    const f = new Float64Array(30);
    f[24 + 1] = P;
    const u = solveFixed(input, all(0), f);
    near(u[25], tip);
  });

  it('fixed-fixed beam, centre load: PL³/192EI + PL/4κGA', () => {
    const input = frame([[0, 0, 0], [L / 2, 0, 0], [L, 0, 0]], [[0, 1], [1, 2]]);
    const f = new Float64Array(18);
    f[6 + 1] = P;
    const u = solveFixed(input, [...all(0), ...all(2)], f);
    near(u[7], (P * L ** 3) / (192 * E * sec.I) + (P * L) / (4 * sec.kappa * sec.G * sec.A));
  });

  it('L-frame: column and beam add bending, shear and axial terms', () => {
    // Column up Y from a fixed base, beam along X, load down at the beam tip.
    const h = 8e-3, a = 5e-3;
    const input = frame([[0, 0, 0], [0, h, 0], [a, h, 0]], [[0, 1], [1, 2]]);
    const f = new Float64Array(18);
    f[12 + 1] = -P;
    const u = solveFixed(input, all(0), f);
    const EI = E * sec.I;
    const expected = (P * a ** 3) / (3 * EI) + (P * a) / (sec.kappa * sec.G * sec.A) + (P * a * a * h) / EI + (P * h) / (E * sec.A);
    near(-u[13], expected);
  });

  it('recovers axial force and peak fibre strain', () => {
    const input = frame([[0, 0, 0], [L, 0, 0]], [[0, 1]]);
    const f = new Float64Array(12);
    f[6] = P; // tension
    const u = solveFixed(input, all(0), f);
    const { axial, strain } = recover(buildFrame(input), u);
    near(axial[0], P);
    near(strain[0], P / sec.A / E);
  });
});

describe('block cholesky', () => {
  // A 4 × 4 × 2 grid of nodes with struts along each axis: big enough
  // for the nested dissection to split.
  const pts: number[][] = [], st: number[][] = [];
  const id = (i: number, j: number, k: number) => (i * 4 + j) * 2 + k;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 2; k++) {
    pts.push([i * 2e-3, j * 2e-3 + 0.1e-3 * i, k * 2e-3]);
    if (i < 3) st.push([id(i, j, k), id(i + 1, j, k)]);
    if (j < 3) st.push([id(i, j, k), id(i, j + 1, k)]);
    if (k < 1) st.push([id(i, j, k), id(i, j, k + 1)]);
  }
  const input = frame(pts, st);
  const m = buildFrame(input);
  const n = pts.length * 6;
  const add = new Float64Array(n);
  for (const node of [0, 1, 2]) for (let a = 0; a < 3; a++) add[node * 6 + a] = 1e6;
  const f = Float64Array.from({ length: n }, (_, i) => Math.sin(i + 1));

  const residual = (pen: Float64Array, u: Float64Array) => {
    const r = bsrMul(m.K, u);
    let e = 0, s = 0;
    for (let i = 0; i < n; i++) { e += (r[i] + pen[i] * u[i] - f[i]) ** 2; s += f[i] ** 2; }
    return Math.sqrt(e / s);
  };

  it('solves (K + D) u = f to round-off with nested dissection ordering', () => {
    const chol = new BlockCholesky(m.K, nestedDissection(input.nodes, m.K, 4));
    expect(chol.factor(m.K, add)).toBe(true);
    expect(residual(add, chol.solve(f))).toBeLessThan(1e-9);
  });

  it('rank-1 updates and downdates match a fresh factorization', () => {
    const chol = new BlockCholesky(m.K, nestedDissection(input.nodes, m.K, 4));
    chol.factor(m.K, add);
    const pen = add.slice();
    // Add springs at three dofs, then remove one of the original supports.
    for (const [dof, v] of [[7 * 6 + 1, 5e5], [20 * 6 + 0, 2e5], [31 * 6 + 2, 1e6], [2 * 6 + 1, -1e6]] as const) {
      expect(chol.rank1(dof, v)).toBe(true);
      pen[dof] += v;
    }
    expect(residual(pen, chol.solve(f))).toBeLessThan(1e-8);
  });
});

describe('compression run', () => {
  // Four 10 mm columns standing on the floor, tops braced by a square
  // frame. The compressor sits g above the tops: once it closes the gap,
  // each column is a bar in compression, so F = 4 EA/L (δ − g).
  const Lc = 10e-3, w = 6e-3, g = 1e-3;
  const pts = [[0, 0, 0], [w, 0, 0], [w, 0, w], [0, 0, w], [0, Lc, 0], [w, Lc, 0], [w, Lc, w], [0, Lc, w]];
  const st = [[0, 4], [1, 5], [2, 6], [3, 7], [4, 5], [5, 6], [6, 7], [7, 4]];
  const base = frame(pts, st);
  const gaps = Float64Array.from([Infinity, Infinity, Infinity, Infinity, g, g, g, g]);

  it('matches n·EA/L after closing the gap, with balanced reactions', () => {
    const res = runSweep({ ...base, gaps, groundY: 0, targets: [1] }, { firstStep: 0.2e-3 });
    const s = res.steps[0];
    expect(res.firstContact).toBeCloseTo(g, 12);
    near(s.force, (4 * E * sec.A * 0.2e-3) / Lc, 1e-4);
    near(s.groundForce, s.force, 1e-6);
    expect(s.converged).toBe(true);
    expect(s.compressorContact.filter((v) => v > 0).length).toBe(4);
    expect(s.violation).toBeLessThan(1e-9);
  });

  it('leaves a node out of contact when the surface never reaches it', () => {
    const far = gaps.slice();
    far[6] = 5e-3;
    const res = runSweep({ ...base, gaps: far, groundY: 0, targets: [1] }, { firstStep: 0.2e-3 });
    const s = res.steps[0];
    expect(s.compressorContact[6]).toBe(0);
    expect(s.compressorContact.filter((v) => v > 0).length).toBe(3);
    // Its top is dragged down by the bracing, but stays below the surface.
    expect(s.u[6 * 6 + 1]).toBeLessThan(0);
    near(s.groundForce, s.force, 1e-6);
  });

  it('steps up to the largest target force', () => {
    const k = (4 * E * sec.A) / Lc;
    const res = runSweep({ ...base, gaps, groundY: 0, targets: [k * 0.3e-3, k * 0.6e-3] });
    const last = res.steps[res.steps.length - 1];
    expect(last.force).toBeGreaterThanOrEqual(k * 0.6e-3 * 0.999);
    expect(res.warnings).toEqual([]);
  });
});
