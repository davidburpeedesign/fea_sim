/**
 * Lattice + Study → solver input. Kept apart from the worker so tests
 * and the UI build exactly the same input.
 */
import type { Lattice } from '../core/types';
import { BW_RANGE, G, type Study } from '../study/study';
import type { SweepInput } from './solve';

/**
 * Force targets for one run: every 0.5 BW up to the slider's maximum. The
 * slider interpolates between solved steps; at this spacing the
 * force-travel curve is close to straight between them (§6.7), and each
 * step costs several seconds.
 */
export function sweepTargets(bodyMass: number, maxBw: number = BW_RANGE.max): number[] {
  const out: number[] = [];
  for (let bw = 0.5; bw <= maxBw + 1e-9; bw += 0.5) out.push(bw * bodyMass * G);
  return out;
}

export function sweepInput(lat: Lattice, gaps: Float64Array, study: Study): SweepInput {
  return {
    nodes: lat.nodes,
    struts: lat.struts,
    strutSection: lat.strutGroup,
    diameters: Float64Array.from(lat.groups, (g) => study.diameter[g]),
    E: study.material.E,
    nu: study.material.nu,
    gaps,
    groundY: lat.bounds.min[1],
    targets: sweepTargets(study.bodyMass),
  };
}
