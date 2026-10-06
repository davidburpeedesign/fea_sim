/**
 * Materials. EPU 46 values are from Carbon's EPU 46 Technical Datasheet
 * (doc #121997-01 Rev A, 27 Sep 2023): ASTM D412 Die C, 0.8 mm specimens,
 * spin-cleaned and baked. SI units.
 *
 * Elastomers have no yield, so there is none here: struts are checked on
 * peak fibre strain against `strainLimit` (where the linear model stops
 * being trustworthy) and `elongationAtBreak` (ARCHITECTURE.md §6.2).
 */
export interface Material {
  id: string;
  name: string;
  /** Small-strain tensile modulus, Pa. */
  E: number;
  nu: number;
  /** kg/m³. */
  density: number;
  /** Pa; shown, never compared with linear stress. */
  tensileStrength: number;
  /** Fraction (3.3 = 330 %). */
  elongationAtBreak: number;
  /** Shore A at 5 s. */
  shoreA: number;
  source: 'datasheet' | 'estimated';
  note?: string;
}

const MPa = 1e6;

// ν 0.49 for every elastomer: nearly incompressible. Beam elements don't
// lock as ν → 0.5; it only enters through G = E / 2(1 + ν).
export const MATERIALS: Material[] = [
  { id: 'epu46', name: 'epu 46', E: 15 * MPa, nu: 0.49, density: 1060, tensileStrength: 26 * MPa, elongationAtBreak: 3.3, shoreA: 78, source: 'datasheet' },
  { id: 'epu46-ipa', name: 'epu 46 · ipa wash', E: 18 * MPa, nu: 0.49, density: 1060, tensileStrength: 25 * MPa, elongationAtBreak: 2.5, shoreA: 78, source: 'datasheet', note: 'ipa washing stiffens parts and shortens elongation' },
  { id: 'epu46-soft', name: 'epu 46 soft', E: 11 * MPa, nu: 0.49, density: 1060, tensileStrength: 21 * MPa, elongationAtBreak: 3.0, shoreA: 71, source: 'datasheet' },
  { id: 'epu46-xsoft', name: 'epu 46 extra soft', E: 4.5 * MPa, nu: 0.49, density: 1060, tensileStrength: 15 * MPa, elongationAtBreak: 2.5, shoreA: 56, source: 'datasheet' },
];

/**
 * Young's modulus from Shore A hardness (Gent 1958), for resins whose
 * datasheet gives none. Rough: for EPU 46 it gives 8.3 MPa against the
 * measured 15, so results built on it are marked `estimated`.
 */
export function modulusFromShoreA(S: number): number {
  return ((0.0981 * (56 + 7.62336 * S)) / (0.137505 * (254 - 2.54 * S))) * MPa;
}
