/**
 * The compressor as a rigid surface, and each lattice node's vertical gap
 * up to it. The compressor only moves in −Y, so contact needs nothing but
 * a downward ray from the surface to each node: a 2D point-in-triangle
 * test in XZ plus a height. A uniform XZ grid over the triangles keeps
 * that to a handful of triangles per node.
 */
import type { GapReport, Indenter, Lattice } from '../core/types';
import type { ObjData } from '../io/obj';

export function buildIndenter(obj: ObjData, name: string, scale: number): Indenter {
  if (obj.triangles.length === 0) throw new Error(`${name}: no faces (OBJ "f" elements) found`);
  const pos = new Float64Array(obj.positions.length);
  for (let i = 0; i < pos.length; i++) pos[i] = obj.positions[i] * scale;

  const tri = obj.triangles;
  let area = 0, ny = 0;
  const edges = new Map<number, number>();
  const n = pos.length / 3;
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1], uz = pos[3 * b + 2] - pos[3 * a + 2];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1], vz = pos[3 * c + 2] - pos[3 * a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    area += Math.hypot(cx, cy, cz) / 2;
    ny += cy / 2; // |n|·A·n_y = cy / 2: area-weighted
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(p, q) * n + Math.max(p, q);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let boundary = 0;
  for (const c of edges.values()) if (c === 1) boundary++;

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[3 * i + k]);
      max[k] = Math.max(max[k], pos[3 * i + k]);
    }
  }

  return {
    name,
    positions: pos,
    triangles: tri,
    bounds: { min, max },
    area,
    boundaryEdges: boundary,
    normalY: area > 0 ? ny / area : 0,
  };
}

interface XzGrid {
  x0: number; z0: number; cell: number; nx: number; nz: number;
  /** Triangle ids per cell (CSR). */
  offsets: Uint32Array; tris: Uint32Array;
}

function buildGrid(ind: Indenter): XzGrid {
  const { positions: p, triangles: t, bounds } = ind;
  const nTri = t.length / 3;
  // About two triangles per cell on average keeps lookups short.
  const w = bounds.max[0] - bounds.min[0], d = bounds.max[2] - bounds.min[2];
  const cell = Math.max(Math.sqrt((w * d) / Math.max(1, nTri / 2)), 1e-9);
  const nx = Math.max(1, Math.ceil(w / cell)), nz = Math.max(1, Math.ceil(d / cell));
  const x0 = bounds.min[0], z0 = bounds.min[2];
  const span = (tIdx: number) => {
    let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = t[3 * tIdx + k];
      ax = Math.min(ax, p[3 * v]); bx = Math.max(bx, p[3 * v]);
      az = Math.min(az, p[3 * v + 2]); bz = Math.max(bz, p[3 * v + 2]);
    }
    const clamp = (v: number, hi: number) => Math.min(hi - 1, Math.max(0, v));
    return [
      clamp(Math.floor((ax - x0) / cell), nx), clamp(Math.floor((bx - x0) / cell), nx),
      clamp(Math.floor((az - z0) / cell), nz), clamp(Math.floor((bz - z0) / cell), nz),
    ];
  };
  const counts = new Uint32Array(nx * nz + 1);
  for (let i = 0; i < nTri; i++) {
    const [i0, i1, k0, k1] = span(i);
    for (let a = i0; a <= i1; a++) for (let b = k0; b <= k1; b++) counts[a * nz + b + 1]++;
  }
  for (let c = 0; c < nx * nz; c++) counts[c + 1] += counts[c];
  const tris = new Uint32Array(counts[nx * nz]);
  const fill = counts.slice(0, nx * nz);
  for (let i = 0; i < nTri; i++) {
    const [i0, i1, k0, k1] = span(i);
    for (let a = i0; a <= i1; a++) for (let b = k0; b <= k1; b++) tris[fill[a * nz + b]++] = i;
  }
  return { x0, z0, cell, nx, nz, offsets: counts, tris };
}

export interface GapOptions {
  /**
   * How far a node may already be through the surface and still count as
   * under it (metres). Beyond this a node is taken to be above the
   * compressor (e.g. the upper's roof) and is never contacted.
   */
  penetration?: number;
}

/**
 * Vertical gap (metres) from each lattice node up to the compressor:
 * surface height above the node minus node height. Infinity for nodes
 * outside the footprint or above the surface.
 */
export function nodeGaps(ind: Indenter, lat: Lattice, opts: GapOptions = {}): Float64Array {
  const pen = opts.penetration ?? 1e-3;
  const g = buildGrid(ind);
  const { positions: p, triangles: t } = ind;
  const nodes = lat.nodes;
  const n = nodes.length / 3;
  const out = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    const x = nodes[3 * i], y = nodes[3 * i + 1], z = nodes[3 * i + 2];
    const cx = Math.floor((x - g.x0) / g.cell), cz = Math.floor((z - g.z0) / g.cell);
    if (cx < 0 || cz < 0 || cx >= g.nx || cz >= g.nz) continue;
    const c = cx * g.nz + cz;
    for (let k = g.offsets[c]; k < g.offsets[c + 1]; k++) {
      const tr = g.tris[k];
      const a = t[3 * tr], b = t[3 * tr + 1], cc = t[3 * tr + 2];
      const ax = p[3 * a], az = p[3 * a + 2], bx = p[3 * b], bz = p[3 * b + 2], qx = p[3 * cc], qz = p[3 * cc + 2];
      const den = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
      if (Math.abs(den) < 1e-18) continue; // edge-on in plan: no vertical hit
      const l1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / den;
      const l2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / den;
      const l3 = 1 - l1 - l2;
      // A small epsilon so nodes exactly on a shared edge aren't missed.
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const gap = l1 * p[3 * a + 1] + l2 * p[3 * b + 1] + l3 * p[3 * cc + 1] - y;
      if (gap >= -pen && gap < out[i]) out[i] = gap;
    }
  }
  return out;
}

export function gapReport(gaps: Float64Array): GapReport {
  const under = [...gaps].filter(Number.isFinite).sort((a, b) => a - b);
  if (!under.length) return { under: 0, min: NaN, median: NaN, max: NaN, interpenetrating: 0 };
  return {
    under: under.length,
    min: under[0],
    median: under[under.length >> 1],
    max: under[under.length - 1],
    interpenetrating: under.filter((v) => v < 0).length,
  };
}
