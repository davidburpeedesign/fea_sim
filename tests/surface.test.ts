import { describe, expect, it } from 'vitest';
import { parseObj } from '../src/io/obj';
import { cleanLattice } from '../src/lattice/clean';
import { buildIndenter, gapReport, nodeGaps } from '../src/contact/surface';

// A 10 × 10 mm plate at y = 5 mm, two triangles, normals facing down.
const PLATE = 'v 0 5 0\nv 0 5 10\nv 10 5 10\nv 10 5 0\nf 1 3 2\nf 1 4 3\n';

describe('compressor surface', () => {
  it('measures area, openness and facing', () => {
    const ind = buildIndenter(parseObj(PLATE), 'plate', 1e-3);
    expect(ind.area).toBeCloseTo(1e-4, 12);
    expect(ind.boundaryEdges).toBe(4);
    expect(ind.normalY).toBeCloseTo(-1, 9);
  });

  it('finds vertical gaps under the footprint only', () => {
    const ind = buildIndenter(parseObj(PLATE), 'plate', 1e-3);
    // Posts: two under the plate (tops at y = 3 and 4.5), one outside it,
    // one whose top is above the plate (never contacted).
    const lat = cleanLattice(parseObj([
      'v 2 0 2', 'v 2 3 2', 'v 5 0 5', 'v 5 4.5 5', 'v 20 0 5', 'v 20 4 5', 'v 8 0 8', 'v 8 9 8',
      'v 2 0 2.0', 'l 1 2', 'l 3 4', 'l 5 6', 'l 7 8', 'l 1 3 5 7',
    ].join('\n')), 'posts', 1e-3);
    const gaps = nodeGaps(ind, lat);
    const byTop = (x: number, z: number, y: number) => {
      for (let i = 0; i < lat.nodes.length / 3; i++) {
        const n = lat.nodes;
        if (Math.abs(n[3 * i] - x * 1e-3) < 1e-9 && Math.abs(n[3 * i + 1] - y * 1e-3) < 1e-9 && Math.abs(n[3 * i + 2] - z * 1e-3) < 1e-9) return gaps[i];
      }
      throw new Error('node not found');
    };
    expect(byTop(2, 2, 3)).toBeCloseTo(2e-3, 12);
    expect(byTop(5, 5, 4.5)).toBeCloseTo(0.5e-3, 12);
    expect(byTop(20, 5, 4)).toBe(Infinity);
    expect(byTop(8, 8, 9)).toBe(Infinity);
    const r = gapReport(gaps);
    expect(r.min).toBeCloseTo(0.5e-3, 12);
    expect(r.interpenetrating).toBe(0);
  });
});
