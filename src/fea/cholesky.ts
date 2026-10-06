/**
 * Sparse Cholesky K + D = L Lᵀ in 6×6 node blocks, with rank-1
 * update/downdate of single diagonal entries.
 *
 * Why direct, and why updates (ARCHITECTURE.md §6.5): the reference shoe
 * needs ~2,400 block-Jacobi CG iterations per solve, warm starts barely
 * help, and a run is ~100 solves. A nested-dissection factor is ~2 GFLOP
 * once; contact then only changes penalty springs on the diagonal, and
 * adding or removing one is a rank-1 change whose pattern stays inside
 * the existing factor, so it is applied along one elimination-tree path
 * (Davis & Hager 1999; CSparse cs_updown) instead of refactoring.
 *
 * Storage: block column j (permuted order) has a dense lower-triangular
 * diagonal block D[j] and off-diagonal blocks L[q] for rows rowIdx[q] > j,
 * each 6×6 row-major (rows: dofs of the row node, cols: dofs of node j).
 */
import type { Bsr } from './model';

export class BlockCholesky {
  readonly n: number;
  readonly perm: Uint32Array;
  readonly inv: Uint32Array;
  readonly colPtr: Uint32Array;
  readonly rowIdx: Uint32Array;
  readonly parent: Int32Array;
  readonly D: Float64Array;
  readonly L: Float64Array;
  /** Estimated flops for one numeric factorization. */
  readonly factorFlops: number;
  /** Estimated flops for one scalar rank-1 update starting at block column j. */
  readonly pathFlops: Float64Array;
  private w: Float64Array;

  constructor(K: Bsr, perm: Uint32Array) {
    const n = K.n;
    this.n = n;
    this.perm = perm;
    this.inv = new Uint32Array(n);
    for (let j = 0; j < n; j++) this.inv[perm[j]] = j;
    const inv = this.inv;

    // Symbolic factorization: pattern(j) = A-pattern below j ∪ children's
    // patterns minus j; parent(j) = first row in pattern(j).
    const parent = new Int32Array(n).fill(-1);
    const childHead = new Int32Array(n).fill(-1), childNext = new Int32Array(n).fill(-1);
    const mark = new Int32Array(n).fill(-1);
    const colPtr = new Uint32Array(n + 1);
    const rows: number[] = [];
    const list: number[] = [];
    for (let j = 0; j < n; j++) {
      list.length = 0;
      mark[j] = j;
      const v = perm[j];
      for (let p = K.rowPtr[v]; p < K.rowPtr[v + 1]; p++) {
        const r = inv[K.col[p]];
        if (r > j && mark[r] !== j) { mark[r] = j; list.push(r); }
      }
      for (let c = childHead[j]; c >= 0; c = childNext[c]) {
        for (let q = colPtr[c]; q < colPtr[c + 1]; q++) {
          const r = rows[q];
          if (r > j && mark[r] !== j) { mark[r] = j; list.push(r); }
        }
      }
      list.sort((a, b) => a - b);
      for (const r of list) rows.push(r);
      colPtr[j + 1] = rows.length;
      if (list.length) {
        parent[j] = list[0];
        childNext[j] = childHead[list[0]];
        childHead[list[0]] = j;
      }
    }
    this.colPtr = colPtr;
    this.rowIdx = Uint32Array.from(rows);
    this.parent = parent;
    this.D = new Float64Array(n * 36);
    this.L = new Float64Array(rows.length * 36);
    this.w = new Float64Array(n * 6);

    let flops = 0;
    const pf = new Float64Array(n);
    for (let j = n - 1; j >= 0; j--) {
      const len = colPtr[j + 1] - colPtr[j];
      flops += ((len * (len + 1)) / 2) * 432 + len * 216 + 216;
      pf[j] = 72 * (len + 1) * 6 + (parent[j] >= 0 ? pf[parent[j]] : 0);
    }
    this.factorFlops = flops;
    this.pathFlops = pf;
  }

  get blocks(): number {
    return this.rowIdx.length + this.n;
  }

  /**
   * Numeric factorization of K + diag(diagAdd) (diagAdd per dof, original
   * numbering). Left-looking: column j gathers updates from every earlier
   * column k with a block in row j. Returns false if not positive definite.
   */
  factor(K: Bsr, diagAdd: Float64Array): boolean {
    const { n, perm, inv, colPtr, rowIdx, D, L } = this;
    let maxLen = 0;
    for (let j = 0; j < n; j++) maxLen = Math.max(maxLen, colPtr[j + 1] - colPtr[j]);
    const C = new Float64Array((maxLen + 1) * 36);
    const pos = new Int32Array(n);
    const head = new Int32Array(n).fill(-1), next = new Int32Array(n).fill(-1);
    const ptr = new Uint32Array(n);

    for (let j = 0; j < n; j++) {
      const c0 = colPtr[j], len = colPtr[j + 1] - c0;
      pos[j] = 0;
      for (let t = 0; t < len; t++) pos[rowIdx[c0 + t]] = t + 1;
      C.fill(0, 0, (len + 1) * 36);

      // Gather column j of K: block (r, j) = K[w, v]ᵀ for w = perm[r].
      const v = perm[j];
      for (let p = K.rowPtr[v]; p < K.rowPtr[v + 1]; p++) {
        const r = inv[K.col[p]];
        if (r < j) continue;
        const o = pos[r] * 36, a = p * 36;
        for (let i = 0; i < 6; i++) for (let k = 0; k < 6; k++) C[o + i * 6 + k] = K.val[a + k * 6 + i];
      }
      for (let i = 0; i < 6; i++) C[i * 7] += diagAdd[v * 6 + i];

      // Updates from earlier columns: C[r] −= L[r,k] L[j,k]ᵀ.
      let k = head[j];
      head[j] = -1;
      while (k >= 0) {
        const nk = next[k];
        const pk = ptr[k], end = colPtr[k + 1];
        const ljk = pk * 36;
        for (let q = pk; q < end; q++) {
          const o = pos[rowIdx[q]] * 36, lrk = q * 36;
          for (let a = 0; a < 6; a++) {
            const r0 = L[lrk + a * 6], r1 = L[lrk + a * 6 + 1], r2 = L[lrk + a * 6 + 2];
            const r3 = L[lrk + a * 6 + 3], r4 = L[lrk + a * 6 + 4], r5 = L[lrk + a * 6 + 5];
            for (let b = 0; b < 6; b++) {
              const jb = ljk + b * 6;
              C[o + a * 6 + b] -= r0 * L[jb] + r1 * L[jb + 1] + r2 * L[jb + 2] + r3 * L[jb + 3] + r4 * L[jb + 4] + r5 * L[jb + 5];
            }
          }
        }
        if (pk + 1 < end) {
          ptr[k] = pk + 1;
          const r2 = rowIdx[pk + 1];
          next[k] = head[r2];
          head[r2] = k;
        }
        k = nk;
      }

      // Dense Cholesky of the 6×6 diagonal block.
      const d = j * 36;
      for (let i = 0; i < 36; i++) D[d + i] = 0;
      for (let a = 0; a < 6; a++) {
        for (let b = 0; b <= a; b++) {
          let s = C[a * 6 + b];
          for (let m = 0; m < b; m++) s -= D[d + a * 6 + m] * D[d + b * 6 + m];
          if (a === b) {
            if (!(s > 0)) return false;
            D[d + a * 6 + a] = Math.sqrt(s);
          } else {
            D[d + a * 6 + b] = s / D[d + b * 6 + b];
          }
        }
      }
      // Off-diagonal blocks: L[r,j] = C[r] Ljj⁻ᵀ, row by row forward solves.
      for (let t = 0; t < len; t++) {
        const o = (t + 1) * 36, out = (c0 + t) * 36;
        for (let a = 0; a < 6; a++) {
          for (let b = 0; b < 6; b++) {
            let s = C[o + a * 6 + b];
            for (let m = 0; m < b; m++) s -= L[out + a * 6 + m] * D[d + b * 6 + m];
            L[out + a * 6 + b] = s / D[d + b * 6 + b];
          }
        }
      }
      if (len) {
        ptr[j] = c0;
        const r0 = rowIdx[c0];
        next[j] = head[r0];
        head[r0] = j;
      }
    }
    return true;
  }

  /** Solve (K + D) x = b, original numbering. */
  solve(b: Float64Array, x = new Float64Array(b.length)): Float64Array {
    const { n, perm, colPtr, rowIdx, D, L } = this;
    const y = new Float64Array(n * 6);
    for (let j = 0; j < n; j++) for (let i = 0; i < 6; i++) y[j * 6 + i] = b[perm[j] * 6 + i];
    for (let j = 0; j < n; j++) {
      const d = j * 36, yj = j * 6;
      for (let a = 0; a < 6; a++) {
        let s = y[yj + a];
        for (let m = 0; m < a; m++) s -= D[d + a * 6 + m] * y[yj + m];
        y[yj + a] = s / D[d + a * 6 + a];
      }
      for (let q = colPtr[j]; q < colPtr[j + 1]; q++) {
        const yr = rowIdx[q] * 6, o = q * 36;
        for (let a = 0; a < 6; a++) {
          let s = 0;
          for (let m = 0; m < 6; m++) s += L[o + a * 6 + m] * y[yj + m];
          y[yr + a] -= s;
        }
      }
    }
    for (let j = n - 1; j >= 0; j--) {
      const d = j * 36, yj = j * 6;
      for (let q = colPtr[j]; q < colPtr[j + 1]; q++) {
        const yr = rowIdx[q] * 6, o = q * 36;
        for (let m = 0; m < 6; m++) {
          let s = 0;
          for (let a = 0; a < 6; a++) s += L[o + a * 6 + m] * y[yr + a];
          y[yj + m] -= s;
        }
      }
      for (let a = 5; a >= 0; a--) {
        let s = y[yj + a];
        for (let m = a + 1; m < 6; m++) s -= D[d + m * 6 + a] * y[yj + m];
        y[yj + a] = s / D[d + a * 6 + a];
      }
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < 6; i++) x[perm[j] * 6 + i] = y[j * 6 + i];
    return x;
  }

  /**
   * L Lᵀ ← L Lᵀ + value · e e ᵀ for dof (original numbering). value < 0 is
   * a downdate. Walks the scalar elimination path: within a node block
   * (j, c) → (j, c+1), and from (j, 5) to the first row block of column j.
   * Returns false if a downdate would lose positive definiteness; the
   * factor is then inconsistent and must be refactored.
   */
  rank1(dof: number, value: number): boolean {
    if (value === 0) return true;
    const { colPtr, rowIdx, D, L, w } = this;
    const sigma = value > 0 ? 1 : -1;
    let j = this.inv[Math.floor(dof / 6)], c = dof % 6;
    w[j * 6 + c] = Math.sqrt(Math.abs(value));
    let beta = 1;
    for (;;) {
      const d = j * 36;
      const s = j * 6 + c;
      const ljj = D[d + c * 7];
      const alpha = w[s] / ljj;
      let beta2 = beta * beta + sigma * alpha * alpha;
      if (!(beta2 > 0)) { w.fill(0); return false; }
      beta2 = Math.sqrt(beta2);
      const delta = sigma > 0 ? beta / beta2 : beta2 / beta;
      const gamma = (sigma * alpha) / (beta2 * beta);
      D[d + c * 7] = delta * ljj + (sigma > 0 ? gamma * w[s] : 0);
      beta = beta2;
      w[s] = 0;
      // Below the diagonal inside the block.
      for (let a = c + 1; a < 6; a++) {
        const idx = d + a * 6 + c, wi = j * 6 + a;
        const w1 = w[wi], w2 = w1 - alpha * D[idx];
        w[wi] = w2;
        D[idx] = delta * D[idx] + gamma * (sigma > 0 ? w1 : w2);
      }
      // Off-diagonal blocks of this block column.
      for (let q = colPtr[j]; q < colPtr[j + 1]; q++) {
        const rb = rowIdx[q] * 6, o = q * 36;
        for (let a = 0; a < 6; a++) {
          const idx = o + a * 6 + c, wi = rb + a;
          const w1 = w[wi], w2 = w1 - alpha * L[idx];
          w[wi] = w2;
          L[idx] = delta * L[idx] + gamma * (sigma > 0 ? w1 : w2);
        }
      }
      if (c < 5) c++;
      else if (colPtr[j + 1] > colPtr[j]) { j = rowIdx[colPtr[j]]; c = 0; }
      else break;
    }
    return true;
  }
}
