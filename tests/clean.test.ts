import { describe, expect, it } from 'vitest';
import { parseObj } from '../src/io/obj';
import { cleanLattice, strutLengths } from '../src/lattice/clean';

/** Build OBJ text from points and polylines (0-based ids). */
function obj(points: number[][], lines: number[][], groups?: string[]): string {
  const out = points.map((p) => `v ${p.join(' ')}`);
  lines.forEach((l, i) => {
    if (groups) out.push(`g ${groups[i]}`);
    out.push(`l ${l.map((k) => k + 1).join(' ')}`);
  });
  return out.join('\n');
}

const clean = (text: string) => cleanLattice(parseObj(text), 'test', 1e-3);

describe('cleanLattice', () => {
  it('dedupes the edge two closed cells share', () => {
    // Two unit squares side by side, each traced as its own closed loop.
    const P = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0], [2, 1, 0]];
    const lat = clean(obj(P, [[0, 1, 4, 3, 0], [1, 2, 5, 4, 1]]));
    expect(lat.report.duplicateSegments).toBe(1);
    // The shared edge's ends are the only junctions. Each outer path
    // between them turns two corners, so it isn't straight and stays as
    // three struts: 3 + 3 + the shared edge.
    expect(lat.report.struts).toBe(7);
    expect(lat.report.curvedChains).toBe(2);
  });

  it('collapses a straight subdivided strut into one element', () => {
    const P = [0, 1, 2, 3, 4, 5].map((i) => [i, 0, 0]);
    const lat = clean(obj(P, [[0, 1, 2, 3, 4, 5]]));
    expect(lat.report.nodes).toBe(2);
    expect(lat.report.struts).toBe(1);
    expect(lat.report.collapsedPoints).toBe(4);
    expect(strutLengths(lat)[0]).toBeCloseTo(5e-3, 12);
    // Source points are kept for exporting results onto the file's curves.
    expect([...lat.strutPoints.points]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('keeps a curved chain as one strut per segment', () => {
    const P = [[0, 0, 0], [1, 0.4, 0], [2, 0.6, 0], [3, 0.4, 0], [4, 0, 0]];
    const lat = clean(obj(P, [[0, 1, 2, 3, 4]]));
    expect(lat.report.curvedChains).toBe(1);
    expect(lat.report.struts).toBe(4);
  });

  it('welds a strut whose ends sit 0.01 mm off the network', () => {
    // A vertical post between two horizontal bars, its ends a hair away.
    const P = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0],
      [1.00001, 0, 0], [1, 1, 0], [1.00001, 2.00001, 0]];
    const lat = clean(obj(P, [[0, 1, 2], [3, 4, 5], [6, 7, 8]]));
    expect(lat.report.welded).toBe(2);
    expect(lat.report.dropped).toHaveLength(0);
    // Each bar splits at the weld: 4 bar struts + 1 post.
    expect(lat.report.struts).toBe(5);
  });

  it('reports and drops pieces that still float', () => {
    const P = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [5, 5, 5], [6, 5, 5]];
    const lat = clean(obj(P, [[0, 1, 2], [3, 4]]));
    expect(lat.report.components).toEqual([1, 1]);
    expect(lat.report.dropped).toHaveLength(1);
    expect(lat.report.dropped[0].nodes).toBe(2);
    expect(lat.report.struts).toBe(1);
  });

  it('keeps a node where the group changes along a straight chain', () => {
    const P = [0, 1, 2, 3, 4].map((i) => [i, 0, 0]);
    const lat = clean(obj(P, [[0, 1, 2], [2, 3, 4]], ['cross', 'baseForm']));
    expect(lat.report.struts).toBe(2);
    expect(lat.groups.sort()).toEqual(['baseForm', 'cross']);
  });

  it('drops zero-length segments and counts group conflicts on shared edges', () => {
    const P = [[0, 0, 0], [0, 0, 0.00001], [1, 0, 0]];
    const lat = clean(obj(P, [[0, 1, 2], [2, 0]], ['a', 'b']));
    expect(lat.report.zeroLengthSegments).toBe(1);
    expect(lat.report.duplicateSegments).toBe(1);
    expect(lat.report.groupConflicts).toBe(1);
  });
});
