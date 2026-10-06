# fea_sim: architecture & outline

> A browser tool for simple deformation analysis of lattice beam models.
> Generate or import a strut lattice, fix and load it, solve a linear
> static frame model, and see how it deforms and where it is stressed.
> Everything runs client-side; models never leave the machine.
> Chrome follows `MORPHXGEN-visual-language.md`, shared with
> `human_data_capture`.

This is the scoping document. Nothing below is built yet; §10 orders the
work into phases with an exit test for each.

---

## 1. Scope

**In (v0):**

- lattices as **beam (frame) models**: nodes joined by circular struts,
  each strut a 3D beam with axial, bending and torsional stiffness
- a lattice generator: unit cell × tiling × strut diameter, into a box
- import of node/strut lists (CSV, JSON, OBJ polylines)
- boundary conditions picked by face or box selection: fixed, pinned,
  roller; loads as nodal forces, a total force spread over a face, or a
  prescribed displacement (a virtual compression test)
- a linear static solve in a Web Worker
- results: deformed shape (scaled), nodal displacement, strut axial force,
  bending moment, combined surface stress and utilisation vs. yield,
  reactions, and the lattice's **effective stiffness** for a compression
  test
- a material library for common additive-manufacturing materials
- a 3D stage, results tables and charts, JSON/CSV export
- a built-in demo lattice so every panel is populated on first load
- verification tests against closed-form beam solutions

**Out, for now:** solid/continuum (tet/hex) elements, plasticity,
large deformation, contact, buckling, dynamics, thermal, cloud solves,
auth. Each is on the roadmap (§11) and the data model leaves room for it.

**Why beams.** A lattice of slender struts is a frame, and a frame model
solves in milliseconds where a solid mesh of the same part needs millions
of elements. Beam models predict stretch- vs. bending-dominated behaviour
and relative stiffness well; they are weakest at the nodes (§12).

---

## 2. Stack

Mirrors `human_data_capture` so the two tools share build, hosting and
look.

| concern | choice | why |
|---|---|---|
| language | TypeScript, strict | the solver is numeric and easy to get subtly wrong |
| ui | React 18 | panels are plain components |
| build | Vite | static output, `base: './'` |
| 3d | three.js | instanced struts, orbit controls, view cube (port from `human_data_capture`) |
| solver | hand-written TS, in a Web Worker | sparse assembly + preconditioned CG; no WASM toolchain in v0 |
| charts | hand-written canvas | same as `human_data_capture` |
| tests | Vitest | elements and solver verified against closed-form results |
| hosting | GitHub Pages via Actions | copy `.github/workflows/deploy.yml` |

No state library, no chart library, no CSS framework, no numeric library.
three.js stays the only heavy dependency. If the solver outgrows TS
(§11, v3), the swap point is the worker boundary, so the UI doesn't change.

---

## 3. Data flow

```
 params ──► lattice/generate.ts ─┐
 (cell, tiling, d)               ├─► lattice/clean.ts ──► Lattice
 file ──► io/<format>.ts ────────┘   merge nodes, drop      nodes, struts,
 (csv, json, obj)                    duplicates / zero-     sections, materials
                                     length / orphans

 Lattice + Study ──► worker: fea/solve.ts ──► Result ──► scene/Viewport,
 (supports, loads,     ├─ dof.ts       numbering, constraints    ui/ResultsPanel,
  material, section)   ├─ element.ts   12×12 beam stiffness       ui/ChartsPanel,
                       ├─ assemble.ts  sparse global K (CSR)       io/export
                       ├─ pcg.ts       Jacobi-preconditioned CG
                       └─ recover.ts   strut forces, stresses, reactions,
                                       effective modulus
```

The generator and importers only produce geometry. Supports, loads and
material live in a separate `Study`, so one lattice can be loaded several
ways and re-solved without re-meshing.

---

## 4. Data model (`src/core/types.ts`)

- **`Lattice`**: `nodes: Float64Array` (xyz, flat), `struts: Uint32Array`
  (node pairs, flat), per-strut `section` index, `sections` table
  (`{ shape: 'circle' | 'tube', d, t? }`), bounding box, provenance
  (`generated` with params, or `imported` with filename).
- **`Material`**: `E`, `nu` (→ `G`), `yield`, `density`, name, and a
  `linear_ok` flag (false for TPU and similar: results are shown but
  flagged, §12).
- **`Study`**: material, supports (`{ nodes, dofs: fixed | pinned | roller-x/y/z }`),
  loads (`nodal force`, `face force` spread equally or by tributary
  area, `prescribed displacement`), solver options.
- **`Result`**: `u: Float64Array` (6 DOF/node), per-strut end forces
  (local N, Vy, Vz, T, My, Mz at both ends), max surface stress and
  utilisation per strut, reactions, solver stats (iterations, residual,
  time), and derived metrics (§7). Status per metric, as in
  `human_data_capture`: `ok`, `proxy` or `unavailable`.

### Conventions

- **Units:** SI inside (m, N, Pa). The UI shows mm, N, MPa; conversion
  happens only at the UI and io boundaries.
- **Frame:** Z up, which is the build direction for printed lattices.
  (`human_data_capture` uses Y-up ISB because it's a gait tool; here the
  build plate convention matters more.)
- **Strut local axes:** x along the strut (node i → j); y, z from a
  reference vector, global Z unless the strut is near-vertical, then
  global X. For circular sections the choice doesn't change stiffness,
  but it fixes the sign of reported moments.
- **Signs:** axial force + is tension.

---

## 5. Lattice generation & import

### 5.1 Unit cells (`lattice/cells.ts`)

Each cell is a list of struts in unit-cube coordinates. Tiling places
copies on an `nx × ny × nz` grid, scales to the cell size, then merges
coincident nodes (spatial hash, tolerance 1e-6 × cell size), so shared
face and edge struts come out once.

| cell | behaviour | notes |
|---|---|---|
| simple cubic | stretch-dominated on-axis, very soft in shear | baseline, easy to hand-check |
| bcc | bending-dominated | the common printed lattice |
| bcc-z (bccz) | mixed | bcc + vertical struts; stiff in build direction |
| fcc / fccz | mixed | face diagonals |
| octet truss | stretch-dominated | E*/Es ≈ ρ̄/9 (Deshpande, Fleck & Ashby 2001): the reference case |
| kelvin (tetrakaidecahedron) | bending-dominated | foam-like |
| diamond | bending-dominated | common in bone scaffolds |

Parameters: cell, cell size, `nx/ny/nz`, strut diameter, optional linear
**grading** of diameter along an axis. The panel shows the derived
**relative density** ρ̄ (strut volume / box volume, with a node-overlap
correction) since it's what stiffness scales with.

### 5.2 Import (`io/`)

| format | notes |
|---|---|
| CSV | two files or two blocks: `nodes(id,x,y,z)` and `struts(i,j,d?)` |
| JSON | the native `Lattice` + `Study` (round-trips everything) |
| OBJ | `v` vertices + `l` line elements; diameter set in the UI |
| others (planned) | Grasshopper / IntraLattice exports, 3MF beam lattice extension (3MF has a native beam-lattice spec, a natural fit) |

Imports pass through `lattice/clean.ts`, which reports what it changed
(merged nodes, removed duplicates and zero-length struts, disconnected
pieces). A disconnected piece that no support touches would make K
singular, so it's flagged before the solve, not after.

---

## 6. Solver

### 6.1 Element (`fea/element.ts`)

3D two-node frame element, 6 DOF per node (ux uy uz θx θy θz), 12×12
local stiffness, rotated to global with the strut's direction cosines.

- **Timoshenko by default**, not Euler-Bernoulli. Printed lattice struts
  are stubby (L/d often 3–10), where shear deformation is a real part of
  the deflection; Euler-Bernoulli overpredicts stiffness there. The
  Timoshenko element reduces to Euler-Bernoulli as L/d grows, so there's
  no need to choose. Shear coefficient for a solid circle: 6(1+ν)/(7+6ν)
  (Cowper 1966).
- Section properties for a circle: A = πd²/4, I = πd⁴/64, J = 2I.
- **Rigid / pinned joints:** joints are rigid (frame) by default. A
  pinned-joint (truss) option releases the end rotations; comparing the
  two is a quick read on how bending-dominated a cell is.

### 6.2 Assembly & solve (`fea/assemble.ts`, `fea/pcg.ts`)

- DOF numbering, then supports removed by elimination (fixed DOFs are
  dropped from the system; prescribed displacements move to the RHS).
- Global K assembled straight into **CSR** (symbolic pass for the
  pattern, numeric pass for values), storing the full symmetric matrix
  for a simple matvec.
- **Preconditioned conjugate gradient** with a block-Jacobi (6×6 per
  node) preconditioner. K is SPD once rigid-body modes are restrained.
  Stop at relative residual 1e-8; report iterations and residual.
- A dense Cholesky solve for models under ~1,500 DOF, used by the tests
  as a reference for PCG.
- Runs in a **Web Worker**; buffers transfer, not copy. The UI shows
  `solving...` and stays responsive.

**Scale target:** a 20×20×20 bcc lattice is ~17k nodes, ~100k DOF,
~64k struts, and should solve in a few seconds in a browser. Beyond
~500k DOF needs the v3 work (§11).

### 6.3 Checks before solving

Unrestrained rigid-body modes (too few supports, or a floating piece),
zero-load studies, and zero-diameter struts are caught up front with a
plain message. If PCG doesn't converge, it reports that rather than
showing a wrong deformed shape.

---

## 7. Results: definitions

| result | definition |
|---|---|
| displacement | per node, magnitude and components (mm); max and where it occurs |
| axial force | N per strut, + tension; the signed field is the clearest map of load paths |
| bending moment | resultant √(My²+Mz²), max of the two ends |
| surface stress | max over both ends of \|N\|/A + M/Z (Z = πd³/32), the peak fibre stress of a circular strut, ignoring the junction notch (§12) |
| utilisation | surface stress / material yield; > 1 is flagged |
| reactions | per support node, and summed: must balance applied load (a solver check shown in the panel) |
| effective modulus E* | prescribed-displacement compression test: E* = (ΣF_reaction / A_box) / (δ / H) |
| relative modulus | E*/Es plotted against ρ̄ with the Gibson-Ashby lines: stretch-dominated (∝ ρ̄) and bending-dominated (∝ ρ̄²) |
| stretch/bending split | share of strain energy in axial vs. bending terms, per strut and in total |
| Euler check (proxy) | per compressed strut, \|N\| / (π²EI / (K·L)²), K = 1 for rigid joints; flags struts likely to buckle. Status `proxy`, since true lattice buckling is a global eigenproblem (§11) |

---

## 8. Interface

Same shell as `human_data_capture`: toolbar, left sidebar, central stage
with corner-tick frame, right tabbed panel, a strip under the stage.

```
┌ toolbar: wordmark · fea_sim · model readout · status · open · export ──────┐
├──────────────┬──────────────────────────────────────┬──────────────────────┤
│ lattice      │                                      │ results│charts│model │
│  cell, size, │        3d stage (three.js)           │                      │
│  tiling, d   │   undeformed (hairline) · deformed   │  tables / charts     │
│ material     │   struts coloured by result field    │                      │
│ supports     │   support + load glyphs · view cube  │                      │
│ loads        ├──────────────────────────────────────┤                      │
│ display      │ field · deformation scale · legend   │                      │
└──────────────┴──────────────────────────────────────┴──────────────────────┘
```

- **Sidebar blocks** (`.block` / `.block__head` from `human_data_capture`):
  lattice (generator or imported file + clean report), material, supports,
  loads, display layers (undeformed, deformed, nodes, glyphs, grid).
- **Stage:** struts as one `InstancedMesh` of cylinders (one draw call
  however many struts), coloured per instance. The undeformed lattice
  stays as bone hairlines (`--mx-bone-16`) under the deformed one, the way
  the ghost layer works in `human_data_capture`. Selection: click a face
  of the bounding box to select its nodes, or drag a box; the selection
  is coral, since coral marks the active item.
- **Under-stage strip** (replaces the gait timeline): result field
  selector, deformation scale (auto = largest displacement shown at 10 %
  of the model size, then a slider; the scale factor is always printed),
  a 0 → 1 load scrub for animating the deformation, and the colour legend
  with its numeric scale.
- **Right panel tabs:** `results` (summary table: max displacement, max
  stress and utilisation, reactions and balance check, E*, ρ̄, solver
  stats), `charts` (E*/Es vs. ρ̄ against Gibson-Ashby lines; a
  load-displacement line; histogram of strut utilisation), `model`
  (node/strut counts, sections, clean report).
- **Toolbar status:** machine-terse, as in `human_data_capture`:
  `ready`, `meshing...`, `solving...`, `solved 412 ms · 38 it`.

### Colour

Reuse `human_data_capture`'s `core/colormap.ts` unchanged. Its diverging
ramp around a near-black zero fits FEA directly:

- **signed fields** (axial force, stress): compression → cool
  (navy → blue → mint), tension → warm (maroon → red → blush), zero
  fuses with the void. Symmetric scale about zero.
- **magnitude fields** (displacement, utilisation): the warm half only,
  black → blush, 0 → max.

Coral stays an indicator (selection, active support set, focus), never a
data colour. Utilisation > 1 is marked with a white outline, not coral.
The legend always shows the numeric scale, since colours aren't
comparable across solves without it.

### Visual rules (from `MORPHXGEN-visual-language.md`)

All lowercase, `#222` void, bone ink, hairline grids, square corners,
corner-tick frame, no shadows, mechanical easing, no emoji. File-handle
naming for generated models: `bcc_5x5x5_d0.6`, `octet_8x8x4_d0.4.study`.
Copy `src/styles/tokens.css` verbatim, and port `app.css` layout,
`.btn`, `.block`, `.tabs`, `.mtable`, `.tick` and the view cube.

---

## 9. Proposed layout

```
src/core/       types, units, vec/mat3, colormap (from human_data_capture)
src/lattice/    cells.ts (unit cell library), generate.ts (tile + merge +
                grade), clean.ts (dedupe, orphans, connectivity), density.ts
src/io/         csv.ts, json.ts, obj.ts, export.ts, index.ts router
src/fea/        element.ts, dof.ts, assemble.ts (CSR), pcg.ts, cholesky.ts,
                recover.ts (forces, stresses, reactions, E*), solve.ts,
                worker.ts
src/study/      supports + loads, face/box selection, presets
                (compression test, cantilever, three-point bend)
src/materials/  library.ts
src/demo/       demo lattice + study (also test fixtures)
src/scene/      Viewport.tsx (instanced struts, glyphs), ViewCube.tsx (port)
src/ui/         Toolbar, Sidebar, ResultsPanel, ChartsPanel, ModelPanel,
                FieldStrip, charts/
src/styles/     tokens.css (verbatim copy) + app.css
tests/          vitest
```

---

## 10. Build phases

Each phase ends with something that runs and a test that proves it.

| phase | work | exit test |
|---|---|---|
| **0. scaffold** | Vite + React + TS + three.js; tokens.css, app.css shell, toolbar, empty sidebar/stage/panel; deploy workflow | page builds and deploys to Pages with the MORPHXGEN shell |
| **1. element + solver core** | `element.ts` (Timoshenko frame), `assemble.ts`, `pcg.ts`, `cholesky.ts`, `recover.ts`; no UI | Vitest: cantilever tip δ = PL³/3EI (+ shear term), fixed-fixed beam, axial bar PL/EA, torsion TL/GJ, a 2D portal frame vs. textbook values, all within 0.1 %; PCG matches Cholesky; reactions balance loads |
| **2. lattice generator** | cell library, tiling, node merge, grading, ρ̄; `clean.ts` | Vitest: node/strut counts per cell and tiling; no duplicate struts; ρ̄ matches analytic values for simple cubic |
| **3. stage** | instanced strut rendering, orbit + view cube port, bounding-box face selection, support/load glyphs | demo lattice renders at 60 fps with 50k struts |
| **4. study + worker** | supports, loads, presets, worker solve, deformed shape + colour fields + legend | compression-test preset solves interactively; deformed shape and fields update without blocking the UI |
| **5. results + charts** | results table, E*, E*/Es vs. ρ̄ chart with Gibson-Ashby lines, utilisation histogram, Euler proxy, export | Vitest: octet E*/Es tends to ρ̄/9 at low ρ̄ (Deshpande 2001); bcc E*/Es scales ~ρ̄² (bending-dominated) |
| **6. import** | CSV / JSON / OBJ, clean report | round-trip tests; a malformed file gives a plain error |

Phases 1 and 2 have no UI dependency and can run alongside 0 and 3.

---

## 11. Roadmap

**v1: better lattice mechanics**
- node stiffening: a rigid zone at each strut end sized from the joint,
  since node material makes stubby lattices stiffer than bare struts
- tube and elliptical sections; per-strut diameter from import
- 3MF beam-lattice import/export
- anisotropy: E* in x, y, z and shear from three compression tests and
  one shear test; a polar plot of directional stiffness

**v2: stability & nonlinearity**
- linear buckling: lowest eigenvalues of (K + λ K_G) by Lanczos;
  mode shapes on the stage
- geometric nonlinearity: corotational beam, load stepping, a
  load-displacement curve past the linear range
- elastic-perfectly-plastic struts (plastic hinges), for crush plateau
  estimates

**v3: performance & sessions**
- solver in WASM (Rust or C), or WebGPU CG for very large lattices
- multiple load cases per study; studies saved in IndexedDB; side-by-side
  comparison
- PDF/HTML report export

**v4: links to the rest of the toolset**
- lattices graded from `human_data_capture` outputs: e.g. a midsole
  lattice whose density follows estimated plantar load, with GRF peaks as
  the load case

---

## 12. Known limitations (to state in the UI and README)

- Beam models treat junctions as points. Real printed nodes add material
  and stiffness and concentrate stress; stiffness of stubby lattices
  (L/d < ~5) is underpredicted, and peak stresses at nodes are not
  captured. Results are for comparing designs, not certifying parts.
- Linear elastic, small displacement. Lattices that buckle, yield or
  densify (most crush loading, all elastomer lattices) are outside v0;
  results for materials with `linear_ok: false` are flagged.
- Printed strut diameters differ from nominal (often by 10 % or more,
  and by build angle); we use nominal unless the import says otherwise.
- The Euler check is per strut; global and cell-level buckling modes
  need the v2 eigen solve.
- Edge struts of a finite lattice are less constrained than interior
  ones, so E* from a small tiling reads low. The results panel notes the
  tiling and suggests ≥ 5 cells per side for effective properties.
