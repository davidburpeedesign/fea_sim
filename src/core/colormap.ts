/**
 * Magnitude colour ramp, ported from human_data_capture's core/colormap.ts
 * so both tools encode "how much" the same way.
 *
 * A diverging ramp around a near-black zero: cool to one side, warm to the
 * other, brightening with distance from the centre. Zero fuses with the
 * dark stage, which is the point: no force, no mark. Signed FEA fields
 * (axial force, stress) use the whole ramp, compression cool and tension
 * warm; magnitude fields (displacement, strain) use the warm half.
 *
 * Stops are interpolated in sRGB, as the gradient they were taken from was.
 */
export const RAMP = [
  '#b2e3d9', // −1  mint
  '#4697c5', //     blue
  '#3056b2',
  '#312e50', //     navy
  '#201c1d', //  0  near-black
  '#532530', //     maroon
  '#aa2744',
  '#ea5964', //     red
  '#f3dada', // +1  blush
] as const;

export type RGB = [number, number, number];

const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
const STOPS: RGB[] = RAMP.map(toRgb);

/** Colour at t ∈ [−1, 1] across the whole ramp (clamped). Channels 0–1. */
export function diverging(t: number): RGB {
  const x = ((Math.max(-1, Math.min(1, t)) + 1) / 2) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** A magnitude m ∈ [0, 1]: from the black centre toward blush. */
export const magnitude = (m: number): RGB => diverging(Math.max(0, m));

export const rgbCss = (c: RGB) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`;

/** CSS gradient of the full ramp, compression (−) to tension (+). */
export const rampCss = (direction = '90deg') =>
  `linear-gradient(${direction}, ${RAMP.map((c, i) => `${c} ${((100 * i) / (RAMP.length - 1)).toFixed(1)}%`).join(', ')})`;
