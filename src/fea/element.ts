/**
 * Two-node 3D Timoshenko frame element, 6 DOF per node
 * (ux uy uz θx θy θz), 12×12 stiffness.
 *
 * Timoshenko rather than Euler-Bernoulli because printed lattice struts
 * are stubby (L/d ≈ 1–7 here), where shear deformation is a real part of
 * the deflection; for slender struts φ → 0 and it reduces to
 * Euler-Bernoulli. Formulation: Przemieniecki, Theory of Matrix
 * Structural Analysis (1968), §5.6. Shear coefficient for a solid circle:
 * κ = 6(1+ν)/(7+6ν) (Cowper 1966).
 *
 * Local axes: x along the strut (node i → j); y, z from a reference
 * vector (global Y, or global X when the strut is near-vertical). For a
 * circular section the choice doesn't change stiffness; it fixes the
 * sign of reported moments.
 */

export interface Section {
  E: number;
  G: number;
  A: number;
  I: number;
  J: number;
  /** Shear correction factor. */
  kappa: number;
  /** Section modulus for bending, I / (d/2). */
  Z: number;
}

export function circleSection(d: number, E: number, nu: number): Section {
  const A = (Math.PI * d * d) / 4;
  const I = (Math.PI * d ** 4) / 64;
  return { E, G: E / (2 * (1 + nu)), A, I, J: 2 * I, kappa: (6 * (1 + nu)) / (7 + 6 * nu), Z: (Math.PI * d ** 3) / 32 };
}

/** Local 12×12 stiffness, row-major. */
export function localStiffness(s: Section, L: number, k = new Float64Array(144)): Float64Array {
  k.fill(0);
  const set = (i: number, j: number, v: number) => { k[i * 12 + j] = v; k[j * 12 + i] = v; };
  const ea = (s.E * s.A) / L;
  set(0, 0, ea); set(6, 6, ea); set(0, 6, -ea);
  const gj = (s.G * s.J) / L;
  set(3, 3, gj); set(9, 9, gj); set(3, 9, -gj);

  // Shear parameter φ = 12EI / (κGA L²); the same in both planes for a circle.
  const phi = (12 * s.E * s.I) / (s.kappa * s.G * s.A * L * L);
  const c = (s.E * s.I) / (L ** 3 * (1 + phi));
  const a = 12 * c, b = 6 * L * c, d4 = (4 + phi) * L * L * c, d2 = (2 - phi) * L * L * c;

  // Bending in the local x–y plane: v (1, 7) and θz (5, 11).
  set(1, 1, a); set(7, 7, a); set(1, 7, -a);
  set(1, 5, b); set(1, 11, b); set(5, 7, -b); set(7, 11, -b);
  set(5, 5, d4); set(11, 11, d4); set(5, 11, d2);

  // Bending in the local x–z plane: w (2, 8) and θy (4, 10). θy = −dw/dx,
  // so the coupling terms flip sign relative to the x–y plane.
  set(2, 2, a); set(8, 8, a); set(2, 8, -a);
  set(2, 4, -b); set(2, 10, -b); set(4, 8, b); set(8, 10, b);
  set(4, 4, d4); set(10, 10, d4); set(4, 10, d2);
  return k;
}

/** Rows are the local x, y, z axes in global coordinates (3×3, row-major). */
export function rotation(dx: number, dy: number, dz: number): Float64Array {
  const L = Math.hypot(dx, dy, dz);
  const ex = [dx / L, dy / L, dz / L];
  const ref = Math.abs(ex[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
  // ez = ex × ref, normalised; ey = ez × ex.
  let ez = [ex[1] * ref[2] - ex[2] * ref[1], ex[2] * ref[0] - ex[0] * ref[2], ex[0] * ref[1] - ex[1] * ref[0]];
  const n = Math.hypot(ez[0], ez[1], ez[2]);
  ez = ez.map((v) => v / n);
  const ey = [ez[1] * ex[2] - ez[2] * ex[1], ez[2] * ex[0] - ez[0] * ex[2], ez[0] * ex[1] - ez[1] * ex[0]];
  return Float64Array.from([...ex, ...ey, ...ez]);
}

/**
 * Global stiffness Kg = Tᵀ k T with T = diag(R, R, R, R), done 3×3 block
 * by block: Kg[a][b] = Rᵀ k[a][b] R.
 */
export function globalStiffness(k: Float64Array, R: Float64Array, out = new Float64Array(144)): Float64Array {
  const tmp = new Float64Array(9);
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      // tmp = k[a][b] R
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let s = 0;
          for (let m = 0; m < 3; m++) s += k[(3 * a + i) * 12 + 3 * b + m] * R[m * 3 + j];
          tmp[i * 3 + j] = s;
        }
      }
      // out[a][b] = Rᵀ tmp
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let s = 0;
          for (let m = 0; m < 3; m++) s += R[m * 3 + i] * tmp[m * 3 + j];
          out[(3 * a + i) * 12 + 3 * b + j] = s;
        }
      }
    }
  }
  return out;
}
