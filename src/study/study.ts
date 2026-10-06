/**
 * The Study: everything about an analysis that isn't geometry. Changing
 * it never re-imports; changing geometry keeps it where groups match.
 */
import { MATERIALS, type Material } from '../materials/library';

export const G = 9.81;

export interface Study {
  /** Strut diameter per group label, metres. */
  diameter: Record<string, number>;
  material: Material;
  /** Linear limit on peak fibre strain (fraction). */
  strainLimit: number;
  /** Target force as a multiple of body weight, 0.5–2.5. */
  bw: number;
  /** kg. */
  bodyMass: number;
}

export const DEFAULT_DIAMETER = 1.5e-3;
export const BW_RANGE = { min: 0.5, max: 2.5, step: 0.1 } as const;

/** Reference loads marked on the slider. */
export const BW_TICKS = [
  { bw: 0.5, label: 'stand' },
  // Second row: 'one foot' is too wide to share a line with its
  // neighbours at 0.5 and 1.2.
  { bw: 1.0, label: 'one foot', row: 1 },
  { bw: 1.2, label: 'walk' },
  { bw: 2.5, label: 'run' },
];

export const defaultStudy = (): Study => ({
  diameter: {},
  material: MATERIALS[0],
  strainLimit: 0.2,
  bw: 1,
  bodyMass: 75,
});

/** Keep diameters for groups already set; default the rest. */
export function withGroups(study: Study, groups: string[]): Study {
  const diameter: Record<string, number> = {};
  for (const g of groups) diameter[g] = study.diameter[g] ?? DEFAULT_DIAMETER;
  return { ...study, diameter };
}

export const targetForce = (s: Study) => s.bw * s.bodyMass * G;
