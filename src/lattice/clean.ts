/**
 * Turn a polyline network into a frame model: one node per junction, one
 * strut per straight run between junctions.
 *
 * Exports from Houdini need four repairs (ARCHITECTURE.md §2.1):
 *   1. weld: pieces whose ends sit a hair off the network (0.01 mm in the
 *      reference shoe) are otherwise separate bodies, and K goes singular
 *   2. dedupe: closed cell loops trace every shared edge twice, which
 *      would double the skins' stiffness
 *   3. simplify: struts arrive resampled into ~1 mm segments. Midsole
 *      struts are straight, so one element each is exact (a straight beam
 *      with no load between its ends). Skin edges bow with the shell
 *      (median 0.05 mm, up to 1 mm), and a bow softens a strut in
 *      tension and compression, so they keep just enough points to stay
 *      within a tolerance of the curve (Douglas–Peucker)
 *   4. drop pieces that still don't connect to the main body
 * Every change is counted in the CleanReport.
 */
import type { Bounds, CleanReport, Lattice } from '../core/types';
import type { ObjData } from '../io/obj';

export interface CleanOptions {
  /** Points closer than this merge. Metres. */
  weldTolerance?: number;
  /**
   * Largest distance a simplified strut may sit from the file's curve.
   * Metres. 0.05 mm is 1/30 of a 1.5 mm strut: below anything that
   * changes stiffness noticeably, and it halves the node count of
   * keeping every point.
   */
  curveTolerance?: number;
}

export const DEFAULT_WELD = 0.05e-3;
export const DEFAULT_CURVE_TOLERANCE = 0.05e-3;

/** Union-find with path halving; representatives are the smallest id. */
class DisjointSet {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    const p = this.parent;
    while (p[x] !== x) {
      p[x] = p[p[x]];
      x = p[x];
    }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent[rb] = ra;
    else this.parent[ra] = rb;
  }
}

/**
 * Merge points within `tol` of each other. Grid cells of side `tol`, so
 * any partner is in one of the 27 neighbouring cells. Merging is
 * transitive (a chain of near points becomes one), which is what we want
 * for welding but means tol must stay well below strut length.
 */
function weld(pos: Float64Array, used: Uint8Array, tol: number): DisjointSet {
  const n = pos.length / 3;
  const ds = new DisjointSet(n);
  const cells = new Map<string, number[]>();
  const tol2 = tol * tol;
  for (let i = 0; i < n; i++) {
    if (!used[i]) continue;
    const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
    const cx = Math.floor(x / tol), cy = Math.floor(y / tol), cz = Math.floor(z / tol);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = cells.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const j of bucket) {
            const ex = pos[3 * j] - x, ey = pos[3 * j + 1] - y, ez = pos[3 * j + 2] - z;
            if (ex * ex + ey * ey + ez * ez <= tol2) ds.union(i, j);
          }
        }
      }
    }
    const key = `${cx},${cy},${cz}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }
  return ds;
}

/** Distance from point p to the line through a and b. */
function lineDistance(pos: Float64Array, p: number, a: number, b: number): number {
  const ax = pos[3 * a], ay = pos[3 * a + 1], az = pos[3 * a + 2];
  const cx = pos[3 * b] - ax, cy = pos[3 * b + 1] - ay, cz = pos[3 * b + 2] - az;
  const len = Math.hypot(cx, cy, cz);
  const px = pos[3 * p] - ax, py = pos[3 * p + 1] - ay, pz = pos[3 * p + 2] - az;
  if (len === 0) return Math.hypot(px, py, pz);
  // |c × p| / |c|
  return Math.hypot(cy * pz - cz * py, cz * px - cx * pz, cx * py - cy * px) / len;
}

/**
 * Douglas–Peucker (Douglas & Peucker 1973): positions in `chain` to keep
 * so that every dropped point is within `tol` of the kept polyline.
 * Iterative, so long chains can't overflow the stack.
 */
function simplify(pos: Float64Array, chain: number[], tol: number): number[] {
  const keep = new Uint8Array(chain.length);
  keep[0] = keep[chain.length - 1] = 1;
  const stack: [number, number][] = [[0, chain.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let worst = -1, far = tol;
    for (let k = i + 1; k < j; k++) {
      const d = lineDistance(pos, chain[k], chain[i], chain[j]);
      if (d > far) { far = d; worst = k; }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, idx) => { if (k) out.push(idx); });
  return out;
}

function boundsOf(pos: Float64Array, ids: Iterable<number>): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const i of ids) {
    for (let k = 0; k < 3; k++) {
      const v = pos[3 * i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

/**
 * Build a Lattice from parsed polylines. `scale` converts file units to
 * metres (1e-3 for millimetre files).
 */
export function cleanLattice(obj: ObjData, name: string, scale: number, opts: CleanOptions = {}): Lattice {
  const tol = opts.weldTolerance ?? DEFAULT_WELD;
  const curveTol = opts.curveTolerance ?? DEFAULT_CURVE_TOLERANCE;
  const { offsets, indices, group } = obj.lines;
  const nLines = offsets.length - 1;
  const nPts = obj.positions.length / 3;
  if (nLines === 0) throw new Error(`${name}: no polylines (OBJ "l" elements) found`);

  const pos = new Float64Array(obj.positions.length);
  for (let i = 0; i < pos.length; i++) pos[i] = obj.positions[i] * scale;

  // 1. Weld.
  const used = new Uint8Array(nPts);
  for (let k = 0; k < indices.length; k++) used[indices[k]] = 1;
  const ds = weld(pos, used, tol);
  let welded = 0;
  for (let i = 0; i < nPts; i++) if (used[i] && ds.find(i) !== i) welded++;

  // 2. Unique segments on welded points. Keys a·n + b stay exact in a
  // double for any point count an OBJ can hold (< 2^26 points).
  const segKey = new Map<number, number>();
  const segA: number[] = [], segB: number[] = [], segG: number[] = [];
  let rawSegments = 0, duplicates = 0, zeroLength = 0, conflicts = 0;
  for (let l = 0; l < nLines; l++) {
    for (let k = offsets[l]; k + 1 < offsets[l + 1]; k++) {
      rawSegments++;
      let a = ds.find(indices[k]), b = ds.find(indices[k + 1]);
      if (a === b) { zeroLength++; continue; }
      if (a > b) [a, b] = [b, a];
      const key = a * nPts + b;
      const seen = segKey.get(key);
      if (seen !== undefined) {
        duplicates++;
        if (segG[seen] !== group[l]) conflicts++;
        continue;
      }
      segKey.set(key, segA.length);
      segA.push(a); segB.push(b); segG.push(group[l]);
    }
  }
  const nSeg = segA.length;

  // Point → incident segments (CSR).
  const deg = new Uint32Array(nPts);
  for (let s = 0; s < nSeg; s++) { deg[segA[s]]++; deg[segB[s]]++; }
  const adjOff = new Uint32Array(nPts + 1);
  for (let i = 0; i < nPts; i++) adjOff[i + 1] = adjOff[i] + deg[i];
  const adj = new Uint32Array(adjOff[nPts]);
  const fill = adjOff.slice(0, nPts);
  for (let s = 0; s < nSeg; s++) { adj[fill[segA[s]]++] = s; adj[fill[segB[s]]++] = s; }

  // 3. A point stays a node if it's a junction or an end, or where the
  // group changes, since diameter is per group.
  const isNode = new Uint8Array(nPts);
  for (let i = 0; i < nPts; i++) {
    if (deg[i] === 0) continue;
    if (deg[i] !== 2) isNode[i] = 1;
    else if (segG[adj[adjOff[i]]] !== segG[adj[adjOff[i] + 1]]) isNode[i] = 1;
  }

  const visited = new Uint8Array(nSeg);
  const chains: { pts: number[]; g: number }[] = [];
  const other = (s: number, p: number) => (segA[s] === p ? segB[s] : segA[s]);
  const walk = (from: number, s0: number) => {
    const pts = [from];
    let s = s0, p = from;
    for (;;) {
      visited[s] = 1;
      p = other(s, p);
      pts.push(p);
      if (isNode[p]) break;
      // Degree-2, so exactly one other segment.
      const s1 = adj[adjOff[p]], s2 = adj[adjOff[p] + 1];
      s = s1 === s ? s2 : s1;
    }
    chains.push({ pts, g: segG[s0] });
  };
  for (let i = 0; i < nPts; i++) {
    if (!isNode[i]) continue;
    for (let k = adjOff[i]; k < adjOff[i + 1]; k++) if (!visited[adj[k]]) walk(i, adj[k]);
  }
  // Closed loops with no junction at all: pin one point and walk round.
  for (let s = 0; s < nSeg; s++) {
    if (visited[s]) continue;
    isNode[segA[s]] = 1;
    walk(segA[s], s);
  }

  // Each chain becomes as few struts as stay within curveTol of it.
  const strutA: number[] = [], strutB: number[] = [], strutG: number[] = [];
  const spOff: number[] = [0], spPts: number[] = [];
  let collapsed = 0, curved = 0;
  const addStrut = (pts: number[], g: number) => {
    strutA.push(pts[0]); strutB.push(pts[pts.length - 1]); strutG.push(g);
    for (const p of pts) spPts.push(p);
    spOff.push(spPts.length);
  };
  for (const { pts, g } of chains) {
    // A closed loop's ends coincide, so its chord is a point; split it at
    // its middle point first so each half has a real chord.
    const keep = pts[0] === pts[pts.length - 1] && pts.length > 3
      ? [...simplify(pos, pts.slice(0, (pts.length >> 1) + 1), curveTol),
        ...simplify(pos, pts.slice(pts.length >> 1), curveTol).slice(1).map((k) => k + (pts.length >> 1))]
      : simplify(pos, pts, curveTol);
    if (keep.length > 2) curved++;
    collapsed += pts.length - keep.length;
    for (let k = 0; k + 1 < keep.length; k++) addStrut(pts.slice(keep[k], keep[k + 1] + 1), g);
  }

  // 4. Connected pieces; keep the largest by strut count.
  const comp = new DisjointSet(nPts);
  for (let s = 0; s < strutA.length; s++) comp.union(strutA[s], strutB[s]);
  const compStruts = new Map<number, number>();
  for (let s = 0; s < strutA.length; s++) {
    const r = comp.find(strutA[s]);
    compStruts.set(r, (compStruts.get(r) ?? 0) + 1);
  }
  const ranked = [...compStruts.entries()].sort((x, y) => y[1] - x[1]);
  const keep = ranked[0][0];
  const dropped = ranked.slice(1).map(([root, struts]) => {
    const ids = new Set<number>();
    for (let s = 0; s < strutA.length; s++) {
      if (comp.find(strutA[s]) === root) { ids.add(strutA[s]); ids.add(strutB[s]); }
    }
    return { struts, nodes: ids.size, bounds: boundsOf(pos, ids) };
  });

  // Compact numbering: nodes, struts, groups.
  const nodeOf = new Int32Array(nPts).fill(-1);
  const nodePoint: number[] = [];
  const groupMap = new Map<number, number>();
  const groups: string[] = [];
  const outA: number[] = [], outB: number[] = [], outG: number[] = [];
  const outOff: number[] = [0], outPts: number[] = [];
  const nodeFor = (p: number) => {
    if (nodeOf[p] < 0) { nodeOf[p] = nodePoint.length; nodePoint.push(p); }
    return nodeOf[p];
  };
  for (let s = 0; s < strutA.length; s++) {
    if (comp.find(strutA[s]) !== keep) continue;
    outA.push(nodeFor(strutA[s]));
    outB.push(nodeFor(strutB[s]));
    let g = groupMap.get(strutG[s]);
    if (g === undefined) { g = groups.length; groups.push(obj.groups[strutG[s]]); groupMap.set(strutG[s], g); }
    outG.push(g);
    for (let k = spOff[s]; k < spOff[s + 1]; k++) outPts.push(spPts[k]);
    outOff.push(outPts.length);
  }

  const nodes = new Float64Array(nodePoint.length * 3);
  nodePoint.forEach((p, i) => {
    nodes[3 * i] = pos[3 * p]; nodes[3 * i + 1] = pos[3 * p + 1]; nodes[3 * i + 2] = pos[3 * p + 2];
  });
  const struts = new Uint32Array(outA.length * 2);
  for (let s = 0; s < outA.length; s++) { struts[2 * s] = outA[s]; struts[2 * s + 1] = outB[s]; }

  const report: CleanReport = {
    points: nPts,
    polylines: nLines,
    segments: rawSegments,
    welded,
    weldTolerance: tol,
    curveTolerance: curveTol,
    duplicateSegments: duplicates,
    zeroLengthSegments: zeroLength,
    groupConflicts: conflicts,
    collapsedPoints: collapsed,
    curvedChains: curved,
    components: ranked.map(([, n]) => n),
    dropped,
    nodes: nodePoint.length,
    struts: outA.length,
  };

  return {
    name,
    nodes,
    struts,
    strutGroup: Uint16Array.from(outG),
    groups,
    nodePoint: Uint32Array.from(nodePoint),
    strutPoints: { offsets: Uint32Array.from(outOff), points: Uint32Array.from(outPts) },
    bounds: boundsOf(nodes, nodePoint.keys()),
    report,
  };
}

/** Strut lengths, metres. */
export function strutLengths(lat: Lattice): Float64Array {
  const n = lat.struts.length / 2;
  const out = new Float64Array(n);
  const p = lat.nodes;
  for (let s = 0; s < n; s++) {
    const a = lat.struts[2 * s], b = lat.struts[2 * s + 1];
    out[s] = Math.hypot(p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]);
  }
  return out;
}
