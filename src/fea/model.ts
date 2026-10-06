/**
 * Frame model: per-strut sections and rotations, and the global stiffness
 * in node-block sparse form (BSR, 6×6 blocks, both triangles stored so a
 * matvec is one pass). Pure TS, no DOM: runs in the worker.
 */
import { circleSection, globalStiffness, localStiffness, rotation, type Section } from './element';

export interface FrameInput {
  /** Node positions, metres, xyz flat. */
  nodes: Float64Array;
  /** Strut end nodes, flat pairs. */
  struts: Uint32Array;
  /** Section index per strut. */
  strutSection: Uint16Array;
  /** Diameter per section, metres. */
  diameters: Float64Array;
  /** Pa. */
  E: number;
  nu: number;
}

/** Block sparse row matrix of 6×6 blocks. */
export interface Bsr {
  n: number;
  rowPtr: Uint32Array;
  col: Uint32Array;
  /** 36 values per block, row-major. */
  val: Float64Array;
  /** Index of the diagonal block in each row. */
  diag: Uint32Array;
}

export interface FrameModel {
  input: FrameInput;
  nNodes: number;
  sections: Section[];
  lengths: Float64Array;
  /** 9 per strut. */
  rotations: Float64Array;
  K: Bsr;
}

export function buildFrame(input: FrameInput): FrameModel {
  const { nodes, struts, strutSection } = input;
  const n = nodes.length / 3;
  const m = struts.length / 2;
  const sections = Array.from(input.diameters, (d) => circleSection(d, input.E, input.nu));

  // Pattern: each node with itself and its strut neighbours, sorted.
  const nbr: number[][] = Array.from({ length: n }, (_, i) => [i]);
  for (let s = 0; s < m; s++) {
    const a = struts[2 * s], b = struts[2 * s + 1];
    nbr[a].push(b);
    nbr[b].push(a);
  }
  const rowPtr = new Uint32Array(n + 1);
  const cols: number[] = [];
  const diag = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const row = [...new Set(nbr[i])].sort((x, y) => x - y);
    diag[i] = cols.length + row.indexOf(i);
    for (const c of row) cols.push(c);
    rowPtr[i + 1] = cols.length;
  }
  const col = Uint32Array.from(cols);
  const val = new Float64Array(col.length * 36);
  const findBlock = (i: number, j: number) => {
    let lo = rowPtr[i], hi = rowPtr[i + 1] - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (col[mid] === j) return mid;
      if (col[mid] < j) lo = mid + 1; else hi = mid - 1;
    }
    throw new Error(`no block ${i},${j}`);
  };

  const lengths = new Float64Array(m);
  const rotations = new Float64Array(m * 9);
  const kl = new Float64Array(144), kg = new Float64Array(144);
  for (let s = 0; s < m; s++) {
    const a = struts[2 * s], b = struts[2 * s + 1];
    const dx = nodes[3 * b] - nodes[3 * a], dy = nodes[3 * b + 1] - nodes[3 * a + 1], dz = nodes[3 * b + 2] - nodes[3 * a + 2];
    const L = Math.hypot(dx, dy, dz);
    lengths[s] = L;
    const R = rotation(dx, dy, dz);
    rotations.set(R, s * 9);
    localStiffness(sections[strutSection[s]], L, kl);
    globalStiffness(kl, R, kg);
    const ends = [a, b];
    for (let p = 0; p < 2; p++) {
      for (let q = 0; q < 2; q++) {
        const blk = findBlock(ends[p], ends[q]) * 36;
        for (let i = 0; i < 6; i++) {
          for (let j = 0; j < 6; j++) val[blk + i * 6 + j] += kg[(6 * p + i) * 12 + 6 * q + j];
        }
      }
    }
  }
  return { input, nNodes: n, sections, lengths, rotations, K: { n, rowPtr, col, val, diag } };
}

/** y = K x. */
export function bsrMul(K: Bsr, x: Float64Array, y = new Float64Array(x.length)): Float64Array {
  const { n, rowPtr, col, val } = K;
  for (let i = 0; i < n; i++) {
    let y0 = 0, y1 = 0, y2 = 0, y3 = 0, y4 = 0, y5 = 0;
    for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
      const o = p * 36, c = col[p] * 6;
      const x0 = x[c], x1 = x[c + 1], x2 = x[c + 2], x3 = x[c + 3], x4 = x[c + 4], x5 = x[c + 5];
      y0 += val[o] * x0 + val[o + 1] * x1 + val[o + 2] * x2 + val[o + 3] * x3 + val[o + 4] * x4 + val[o + 5] * x5;
      y1 += val[o + 6] * x0 + val[o + 7] * x1 + val[o + 8] * x2 + val[o + 9] * x3 + val[o + 10] * x4 + val[o + 11] * x5;
      y2 += val[o + 12] * x0 + val[o + 13] * x1 + val[o + 14] * x2 + val[o + 15] * x3 + val[o + 16] * x4 + val[o + 17] * x5;
      y3 += val[o + 18] * x0 + val[o + 19] * x1 + val[o + 20] * x2 + val[o + 21] * x3 + val[o + 22] * x4 + val[o + 23] * x5;
      y4 += val[o + 24] * x0 + val[o + 25] * x1 + val[o + 26] * x2 + val[o + 27] * x3 + val[o + 28] * x4 + val[o + 29] * x5;
      y5 += val[o + 30] * x0 + val[o + 31] * x1 + val[o + 32] * x2 + val[o + 33] * x3 + val[o + 34] * x4 + val[o + 35] * x5;
    }
    const r = i * 6;
    y[r] = y0; y[r + 1] = y1; y[r + 2] = y2; y[r + 3] = y3; y[r + 4] = y4; y[r + 5] = y5;
  }
  return y;
}

/**
 * Strut end forces in local axes from global displacements: f = k T uₑ.
 * Returns the 12 local end forces (end i then end j).
 */
export function strutEndForces(model: FrameModel, s: number, u: Float64Array, out = new Float64Array(12), k = new Float64Array(144)): Float64Array {
  const { struts, strutSection } = model.input;
  const R = model.rotations.subarray(s * 9, s * 9 + 9);
  const ends = [struts[2 * s], struts[2 * s + 1]];
  const ul = new Float64Array(12);
  for (let e = 0; e < 2; e++) {
    for (let t = 0; t < 2; t++) {
      const g = ends[e] * 6 + t * 3;
      for (let i = 0; i < 3; i++) ul[e * 6 + t * 3 + i] = R[i * 3] * u[g] + R[i * 3 + 1] * u[g + 1] + R[i * 3 + 2] * u[g + 2];
    }
  }
  localStiffness(model.sections[strutSection[s]], model.lengths[s], k);
  for (let i = 0; i < 12; i++) {
    let v = 0;
    for (let j = 0; j < 12; j++) v += k[i * 12 + j] * ul[j];
    out[i] = v;
  }
  return out;
}
