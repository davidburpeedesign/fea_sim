/**
 * Fill-reducing node ordering for the Cholesky factor: geometric nested
 * dissection. Split the nodes at the median of their longest extent; the
 * nodes on one side that touch the other form a separator; order the two
 * halves recursively, then the separator last (George 1973).
 *
 * Chosen over minimum degree because the coordinates make it simple and
 * fast, and on the reference shoe it measured ~590k factor blocks and
 * ~2 GFLOP (ARCHITECTURE.md §6.5).
 */
import type { Bsr } from './model';

export function nestedDissection(nodes: Float64Array, K: Bsr, leaf = 64): Uint32Array {
  const n = K.n;
  const order: number[] = [];
  const inSet = new Int32Array(n).fill(-1);
  const isLeft = new Int32Array(n).fill(-1);
  let token = 0;

  const split = (ids: number[]) => {
    if (ids.length <= leaf) {
      for (const v of ids) order.push(v);
      return;
    }
    const me = token++;
    for (const v of ids) inSet[v] = me;
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const v of ids) {
      for (let k = 0; k < 3; k++) {
        const c = nodes[3 * v + k];
        if (c < lo[k]) lo[k] = c;
        if (c > hi[k]) hi[k] = c;
      }
    }
    let ax = 0;
    for (let k = 1; k < 3; k++) if (hi[k] - lo[k] > hi[ax] - lo[ax]) ax = k;
    const coords = ids.map((v) => nodes[3 * v + ax]).sort((a, b) => a - b);
    const med = coords[coords.length >> 1];

    const left: number[] = [], right: number[] = [];
    for (const v of ids) {
      if (nodes[3 * v + ax] < med) { left.push(v); isLeft[v] = me; } else right.push(v);
    }
    // Degenerate split (many equal coordinates): fall back to halving the list.
    if (!left.length || !right.length) {
      const h = ids.length >> 1;
      split(ids.slice(0, h));
      split(ids.slice(h));
      return;
    }
    const sep: number[] = [], inner: number[] = [];
    for (const v of left) {
      let touches = false;
      for (let p = K.rowPtr[v]; p < K.rowPtr[v + 1] && !touches; p++) {
        const w = K.col[p];
        if (inSet[w] === me && isLeft[w] !== me) touches = true;
      }
      (touches ? sep : inner).push(v);
    }
    split(inner);
    split(right);
    for (const v of sep) order.push(v);
  };

  split(Array.from({ length: n }, (_, i) => i));
  return Uint32Array.from(order);
}
