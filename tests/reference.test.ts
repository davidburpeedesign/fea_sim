/**
 * The reference shoe from ARCHITECTURE.md §2. The OBJs aren't committed;
 * put them in tests/fixtures/local/ to run this. Expected values are the
 * ones measured while scoping (§2.1–2.2).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importObjText } from '../src/io/index';
import { gapReport, nodeGaps } from '../src/contact/surface';
import { strutLengths } from '../src/lattice/clean';
import { runSweep } from '../src/fea/solve';
import { sweepInput } from '../src/fea/input';
import { defaultStudy, withGroups } from '../src/study/study';

const dir = fileURLToPath(new URL('./fixtures/local/', import.meta.url));
const LATTICE = `${dir}20261002_exported_lines.obj`;
const COMPRESSOR = `${dir}compressor.obj`;
const present = existsSync(LATTICE) && existsSync(COMPRESSOR);

const lat = present ? importObjText(readFileSync(LATTICE, 'utf8'), 'lattice') : null;
const ind = present ? importObjText(readFileSync(COMPRESSOR, 'utf8'), 'compressor') : null;

describe.skipIf(!present)('reference shoe', () => {

  it('cleans to 30,683 struts on 18,831 nodes in one piece', () => {
    if (lat?.kind !== 'lattice') throw new Error('expected a lattice');
    const r = lat.lattice.report;
    expect(r.points).toBe(94731);
    expect(r.polylines).toBe(11146);
    expect(r.segments).toBe(160174);
    expect(r.welded).toBe(2);
    expect(r.duplicateSegments).toBe(53593);
    expect(r.zeroLengthSegments).toBe(0);
    // Midsole and connector struts are straight; skin edges bow with the
    // shell and keep enough points to stay within 0.05 mm (§2.1).
    expect(r.curvedChains).toBe(6645);
    expect(r.groupConflicts).toBe(4);
    expect(r.dropped).toHaveLength(0);
    expect(r.nodes).toBe(18831);
    expect(r.struts).toBe(30683);
    expect([...lat.lattice.groups].sort()).toEqual(['(no group)', 'baseForm', 'baseForm inner', 'cross']);
    const L = strutLengths(lat.lattice);
    expect(Math.min(...L)).toBeGreaterThan(0);
  });

  it('reads the compressor as an open, downward-facing sheet', () => {
    if (ind?.kind !== 'indenter') throw new Error('expected an indenter');
    expect(ind.indenter.triangles.length / 3).toBe(1685);
    expect(ind.indenter.boundaryEdges).toBe(131);
    expect(ind.indenter.normalY).toBeLessThan(-0.9);
    expect(ind.indenter.area * 1e6).toBeCloseTo(19530, -1);
  });

  it('sits ~2 mm above the footbed with nothing interpenetrating', () => {
    if (lat?.kind !== 'lattice' || ind?.kind !== 'indenter') throw new Error('fixtures');
    const gaps = nodeGaps(ind.indenter, lat.lattice);
    const r = gapReport(gaps);
    expect(r.interpenetrating).toBe(0);
    expect(r.min * 1e3).toBeCloseTo(1.984, 3);
    // Footbed nodes: everything within 1 mm of first contact, all closing
    // by ~3 mm of travel.
    const footbed = [...gaps].filter((g) => g < r.min + 1e-3);
    expect(footbed.length).toBe(2106);
    expect(Math.max(...footbed) * 1e3).toBeLessThan(3);
  });
});

describe.skipIf(!present)('reference shoe, first solve step', () => {
  it('balances reactions and holds contacts at 1.5 mm struts in EPU 46', () => {
    if (lat?.kind !== 'lattice' || ind?.kind !== 'indenter') throw new Error('fixtures');
    const input = sweepInput(lat.lattice, nodeGaps(ind.indenter, lat.lattice), withGroups(defaultStudy(), lat.lattice.groups));
    // One step, 0.3 mm past first contact: the prototype's force-travel
    // curve puts this at ~80 N (ARCHITECTURE.md §6.7).
    const res = runSweep({ ...input, targets: [1] });
    const s = res.steps[0];
    expect(s.converged).toBe(true);
    expect(Math.abs(s.force - s.groundForce) / s.force).toBeLessThan(1e-6);
    expect(s.residual).toBeLessThan(1e-5);
    expect(s.violation).toBeLessThan(1e-9);
    expect(s.force).toBeGreaterThan(60);
    expect(s.force).toBeLessThan(110);
  }, 180_000);
});
