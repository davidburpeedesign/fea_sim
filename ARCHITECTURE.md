# fea_sim: architecture & outline

> A browser tool for simple deformation analysis of lattice beam models.
> Load a lattice exported as a curve network and a rigid compressor
> surface, press the compressor down into the lattice, and see how the
> lattice deforms, where it is stressed, and how stiff it is.
> Everything runs client-side; geometry never leaves the machine.
> Chrome follows `MORPHXGEN-visual-language.md`, shared with
> `human_data_capture`.

This is the scoping document. Nothing below is built yet; §11 orders the
work into phases with an exit test for each.

---

## 1. Scope

The tool analyses geometry it is given. It does not generate or edit
lattices: all geometry comes from Houdini (or similar) as files.

**In (v0):**

- import a **lattice** as a polyline network (OBJ `l` elements) and turn
  it into a beam (frame) model: weld, dedupe, simplify subdivided
  struts, drop floating pieces, and report what changed
- import a **compressor** as a triangulated surface (OBJ `f` elements)
  and treat it as a rigid body that moves straight down into the lattice
- a rigid **ground** plane under the lattice as the support
- strut diameter per OBJ group (default 1.5 mm for all), and an
  elastomer material defined from its datasheet (§6.2)
- one-sided **contact**, with stick, between the lattice and both the
  compressor and the ground. Struts only take load once the compressor
  reaches them, and the outsole's curved heel and toe only bear once they
  touch the floor
- a linear static solve per load step in a Web Worker, stepping the
  compressor down until it reaches a **target force**
- results: deformed shape, displacements, strut forces and stresses,
  peak fibre strain, a force-displacement curve, overall stiffness, and the
  contact pressure map on the compressor
- a 3D stage, results tables and charts, JSON/CSV export
- verification tests against closed-form beam solutions

**Out, for now:** generating or editing lattices, solid elements,
plasticity, large deformation, buckling, dynamics, friction models beyond
stick / slip, cloud solves. Each is on the roadmap (§12).

**Why beams.** A lattice of slender struts is a frame. A frame model
solves in a fraction of a second, where a solid mesh of the same part
needs millions of elements. The curve-network export already gives us a
frame; we never build a mesh.

---

## 2. Reference geometry

Two files were supplied for scoping (`20261002_exported_lines.obj`,
`compressor.obj`). Both are Houdini 22 OBJ exports. What they contain,
measured, is what the importer is designed around.

### 2.1 Lattice: `20261002_exported_lines.obj`

A lattice shoe: a double-skin voronoi upper and a midsole lattice
between an outsole skin and a footbed skin.

| | |
|---|---|
| frame | **Y up**, length along Z (toe at −Z, heel at +Z), width along X |
| units | millimetres (≈ 121 × 138 × 298 mm overall) |
| raw content | 94,731 points, 11,146 polylines, 160,174 segments |
| per-point extras | `vn` normals and a vertex colour (red ≈ midsole, white elsewhere); not used by the analysis |

Groups (OBJ `g`; a polyline can belong to more than one):

| group | role | polylines | struts after cleaning | median strut length |
|---|---|---|---|---|
| `cross` | midsole lattice, between outsole and footbed | 4,769 | 6,290 | 6.6 mm |
| `baseForm` | outer skin: voronoi cell loops, incl. the outsole | 2,210 closed | 6,345 | 4.3 mm |
| `baseForm inner` | inner skin: voronoi cell loops, incl. the footbed | 2,210 closed | 6,345 | 4.0 mm |
| *(no group)* | through-thickness connectors between the skins | 1,957 | 1,970 | 3.0 mm |

What the importer has to deal with:

1. **Every skin edge is in the file twice.** Each closed cell loop
   traces its own boundary, so an edge shared by two cells appears in
   both loops: 53,569 segments occur twice and 8 four times. Imported
   as-is, the skins would be twice as stiff as they should be.
   Segments are deduplicated by their endpoint pair.
2. **Struts are subdivided, and the skin edges bow.** Every strut is
   resampled into ~5 segments of ~0.9 mm. Midsole (`cross`) and connector
   struts are straight. Skin edges follow the curved shell: their bow
   off the straight line between junctions is 0.05 mm at the median,
   ~0.2 mm at p90 and up to 1 mm. (Scoping first called every strut
   straight from the median arc/chord ratio; the phase 1 tests caught
   it.) A bow matters: on a 1.5 mm strut, 0.2 mm of bow makes it
   noticeably softer in tension and compression than a straight one.
   So each chain between junctions is simplified with Douglas–Peucker
   (Douglas & Peucker 1973) to the fewest points that stay within
   **0.05 mm** of the file's curve (1/30 of the strut diameter).
   Straight struts become one element each, which is exact (a straight
   beam with no load between its ends); 6,645 bowed chains keep a few
   points. Result: **30,683 struts on 18,831 nodes, ~113k degrees of
   freedom** instead of ~570k for every file point. The nonlinear
   phases (§12) re-subdivide on demand.
3. **One floating strut.** A 12 mm vertical `cross` strut at
   (−27, −63) has endpoints 0.01 mm from lattice nodes but not welded to
   them. It's a separate piece with nothing holding it, so the stiffness
   matrix would be singular. Points are welded at 0.05 mm, which
   joins it; anything still disconnected after welding is reported and
   dropped.
4. **No diameters.** OBJ polylines carry no thickness, so diameter is set
   per group in the UI (§5.2).

### 2.2 Compressor: `compressor.obj`

| | |
|---|---|
| content | 909 vertices, 1,685 triangles, open single-sided surface (131 boundary edges), area ≈ 19,500 mm² |
| shape | a footbed: the plantar surface the foot would press on, spanning heel to toe |
| orientation | normals point down (−Y), towards the lattice |
| position | **2.0 mm above the footbed skin** everywhere it overlaps. First contact after 1.98 mm of travel; 2,106 footbed nodes are within 1 mm of that and all close by 3.0 mm. It is the footbed offset upward, so contact closes almost uniformly after 2 mm of travel |

Below the compressor footprint: the footbed (`baseForm inner`) nodes
within 2–3 mm, then the `cross` midsole, then the outsole
(`baseForm`) 8–14 mm further down. 345 outsole nodes lie within 0.5 mm of
the lowest point (y = −13.0 mm); the rest of the outsole curves up at
heel and toe.

### 2.3 What the importer assumes of future files

- polylines (`l`) for the lattice, triangles (`f`) for the compressor;
  `v` lines may carry colours, `vn` / `vt` are ignored
- consistent units between the two files (millimetres)
- the same up axis in both files; Y up by default, switchable
- struts may be subdivided straight lines or curves; both are simplified
  to within the curve tolerance (0.05 mm by default)
- groups name the parts that get different diameters

---

## 3. Stack

Mirrors `human_data_capture` so the two tools share build, hosting and
look.

| concern | choice | why |
|---|---|---|
| language | TypeScript, strict | the solver is numeric and easy to get subtly wrong |
| ui | React 18 | panels are plain components |
| build | Vite | static output, `base: './'` |
| 3d | three.js | instanced struts, OBJ loading, orbit controls, view cube (ported from `human_data_capture`) |
| solver | hand-written TS, in a Web Worker | node-block sparse Cholesky with rank-1 contact updates (§6.5); no WASM toolchain in v0 |
| charts | hand-written canvas | same as `human_data_capture` |
| tests | Vitest | elements and solver verified against closed-form results |
| hosting | GitHub Pages via Actions | copy `.github/workflows/deploy.yml` |

No state library, no chart library, no CSS framework, no numeric library.
three.js stays the only heavy dependency. The OBJ parser is our own (~100
lines): three.js's `OBJLoader` doesn't expose the point indices and
groups the cleaning step needs.

---

## 4. Data flow

```
 lattice.obj ──► io/obj.ts ──► lattice/clean.ts ──────────────► Lattice
 (polylines)      points,       weld 0.05 mm → dedupe segments     nodes, struts,
                  polylines,    → simplify chains (0.05 mm)         group per strut,
                  groups        → drop floating pieces              clean report
                                → report

 compressor.obj ─► io/obj.ts ──► contact/surface.ts ──────────► Indenter
 (triangles)                     xz grid of triangles, down        rigid surface +
                                 ray casts; gap per lattice node   per-node gap

 Lattice + Indenter + Study ──► worker: fea/solve.ts ──► steps ──► fea/results.ts ──► scene/Viewport,
 (diameters, material,           ├─ element.ts   12×12 beam         (slider: interpolate,   ui/ResultsPanel,
  ground, load target)           ├─ model.ts     node-block K       E rescale)              ui/ChartsPanel,
                                 ├─ order.ts     nested dissection                          ui/FieldStrip
                                 ├─ cholesky.ts  factor, solve,
                                 │               rank-1 update
                                 └─ solve.ts     contact steps,
                                                 strut forces, strain
```

### 4.1 Study defaults (decided)

| setting | value |
|---|---|
| strut diameter | 1.5 mm, every group |
| material | **Carbon EPU 46** (elastomeric polyurethane, Carbon DLS), from Carbon's EPU 46 TDS: E 15 MPa, tensile strength 26 MPa, elongation at break 330 %, Shore 78A, 1.06 g/mL (§6.2). EPU 46 Soft and Extra Soft are in the library |
| body mass | **75 kg** (slider range 368–1,839 N) |
| load | a **force** target set on a slider from **0.5 to 2.5 × body weight**; the compressor travels down until it carries it |
| linear limit | **20 %** peak fibre strain |
| start | as modelled, 2 mm clear of the footbed. Stepping starts at first contact, so the gap costs nothing and nothing has to be moved |
| extent | the **whole lattice**: upper, skins, connectors and midsole |
| friction | **stick** on both the compressor and the ground |

Geometry (`Lattice`, `Indenter`) is separate from the `Study` (diameters,
material, supports, load), so changing a diameter or the target load
re-solves without re-importing.

---

## 5. Data model (`src/core/types.ts`)

- **`Lattice`**: `nodes: Float64Array` (xyz, flat), `struts: Uint32Array`
  (node pairs, flat), `strutGroup: Uint8Array` into `groups: string[]`,
  bounding box, and the `CleanReport` (welded points, duplicate segments
  removed, points simplified away, bowed chains, floating pieces
  dropped). Source file name and hash.
- **`Indenter`**: triangle soup (`Float64Array` + `Uint32Array`), a
  uniform xz grid over its triangles for fast vertical ray casts, and per
  lattice node the initial gap along −Y (`Infinity` outside the
  footprint or above the surface).
- **`Study`**:
  - `sections: Record<group, { d: number }>` (circular, mm in the UI;
    default 1.5)
  - `material`: `{ name, E, nu, density, tensileStrength,
    elongationAtBreak, shoreA, strainLimit, curve?, dma?, source }`.
    `curve` is the datasheet tensile curve (for the v2 hyperelastic
    fit), `dma` the digitised E′(T), and `source` is `datasheet` or
    `estimated` (E from Shore hardness, for resins without a modulus)
  - `ground`: `{ y: 'auto' | number, friction: 'stick' | 'slip' }`
  - `indenter`: `{ friction: 'stick' | 'slip' }`
  - `load`: `{ target: 'force', bw, bodyMass }` (the default: N =
    bw × bodyMass × g, bw ∈ [0.5, 2.5]) or `{ target: 'displacement',
    mm }` (kept for debugging and tests), plus `steps`
  - `include: Record<group, boolean>`, all on by default
- **`Result`**: per load step: compressor travel, total force, active
  contact nodes. For the final step: `u: Float64Array` (6 DOF/node), strut
  end forces (local N, Vy, Vz, T, My, Mz), max surface stress and
  peak fibre strain per strut, ground reactions, contact force per node, solver
  stats. Each derived metric carries a status, as in `human_data_capture`:
  `ok`, `proxy` or `unavailable`.

### Conventions

- **Units:** SI inside (m, N, Pa). Files and the UI use mm, N, MPa;
  conversion happens only at the io and UI boundaries.
- **Frame:** the files' frame. **Y up**, compressor travels in −Y. We
  don't re-orient, so node positions and ids match what Houdini shows.
- **Strut local axes:** x along the strut (node i → j); y, z from a
  reference vector, global Y unless the strut is near-vertical, then
  global X. Fixes the sign of reported moments; stiffness of a circular
  section doesn't depend on it.
- **Signs:** axial force + is tension. Compressor force is reported
  positive in compression (pushing down).

---

## 6. Model

### 6.1 Element (`fea/element.ts`)

3D two-node frame element, 6 DOF per node (ux uy uz θx θy θz), 12×12
local stiffness, rotated to global with the strut's direction cosines.
Joints are rigid: a junction carries moment between all its struts.

- **Timoshenko**, not Euler-Bernoulli. Struts here are short: median
  3–7 mm long, and likely 1–2 mm thick, so L/d is 2–7. At those ratios
  shear deformation is a real part of the deflection and
  Euler-Bernoulli would overpredict stiffness. Timoshenko reduces to
  Euler-Bernoulli for slender struts, so it is right everywhere. Shear
  coefficient for a solid circle: 6(1+ν)/(7+6ν) (Cowper 1966).
- Circle section: A = πd²/4, I = πd⁴/64, J = 2I.

### 6.2 Material (`materials/library.ts`)

The lattice is printed in **Carbon EPU 46**, an elastomeric polyurethane
made by Carbon's light-based DLS process. The reference is Carbon's EPU
46 Technical Datasheet (doc #121997-01 Rev A, 27 Sep 2023). Values are
for EPU 46 Black, L-series printer, centrifugal spin clean, standard
bake:

| property | test | 0.8 mm specimen | 2 mm specimen |
|---|---|---|---|
| tensile modulus | ASTM D412 Die C, 500 mm/min | 15 MPa | 14 MPa |
| stress at 50 / 100 / 200 % | ″ | 4 / 7 / 19 MPa | 4 / 7 / 19 MPa |
| ultimate tensile strength | ″ | 26 MPa | 23 MPa |
| elongation at break | ″ | 330 % | 300 % |
| tear strength | ASTM D624 Die C | 44 kN/m | 34 kN/m |
| hardness | ASTM D2240 | Shore 80A instant, 78A at 5 s | |
| Bayshore resilience | ASTM D2632 | 36 % | |
| compression set | ASTM D395-B, 23 °C, 72 h | 26 % | |
| Ross flex, 23 °C and −10 °C | ASTM D2632 | > 100,000 cycles | |
| Tg (DMA tan δ) | ASTM D4065, 1 Hz | −6 °C | |
| density | ASTM D792 | 1.06 g/mL | |

How the model uses it:

- **E = 15 MPa**, the D412 tensile modulus of the 0.8 mm specimen, as
  the small-strain modulus of every strut. The 2 mm specimen gives
  14 MPa, so 1.5 mm struts sit within that 7 % band.
- **ν = 0.49**: elastomers are nearly incompressible. Beam elements
  don't lock as ν → 0.5; ν only enters through G = E / 2(1+ν).
- **Density 1.06 g/mL** gives the lattice mass, reported with the
  results: strut volume × density, ~188 g for the reference shoe with
  1.5 mm struts. That counts node overlaps twice, so it reads a little
  high.
- **No yield.** Elastomers fail by strain, not stress, so the check is
  on **peak fibre strain** rather than stress / yield. Two thresholds:
  - *linear limit* (**20 %**): above it the linear result is no longer
    trustworthy for that strut. Shown as a warning, per strut and as a
    count
  - *break* (330 %): a hard flag. The linear limit is reached long
    before it
- **Why 20 % is about right.** The datasheet's tensile curve softens
  early. Its secant modulus is ~8 MPa at 50 % strain (4 MPa / 0.5)
  against 15 MPa at the origin, then it stiffens again past ~100 %.
  Up to ~20 % the linear model overestimates strut stress by roughly a
  quarter or less (read off the curve, not measured). Beyond that the
  real strut is noticeably softer than the model, so the model
  underpredicts deflection at hot struts.
- Tensile strength (26 MPa) is stored and shown but not compared with
  linear stress, which at large strain is nowhere near the real curve.
  Tear strength, resilience, compression set and Ross flex are shown
  for reference. They bear on durability, energy return and long-term
  set, none of which a linear static model captures.

**Library entries** (all from the same datasheet, 0.8 mm specimens):

| material | E | tensile strength | elongation at break | Shore A (5 s) |
|---|---|---|---|---|
| EPU 46 (default) | 15 MPa | 26 MPa | 330 % | 78 |
| EPU 46 Soft | 11 MPa | 21 MPa | 300 % | 71 |
| EPU 46 Extra Soft | 4.5 MPa | 15 MPa | 250 % | 56 |

Swapping between the three is the cheapest design variable the tool
offers, since it changes no geometry. A post-processing toggle covers
the datasheet's IPA-wash variant (EPU 46: 18 MPa, 250 %), since washing
stiffens parts and shortens elongation. If a future resin's datasheet
gives no modulus, E is estimated from Shore A with Gent's relation
(Gent 1958; for EPU 46 it gives 8.3 MPa against the measured 15, a
reminder of how rough that is) and marked `estimated`.

**Temperature and loading rate.** EPU 46 sits close to its glass
transition (Tg −6 °C), so stiffness is sensitive to temperature. The
datasheet's DMA curve (1 Hz storage modulus E′) reads roughly 20 MPa
at 23 °C, ~45 MPa at 0 °C and well over 100 MPa at −20 °C (read off a
log-scale chart). Two consequences:
- *cold*: the same midsole at 0 °C is roughly twice as stiff as at room
  temperature. v1 adds a temperature input that scales E by the DMA
  curve, digitised into the material entry
- *rate*: gait loads at ~1 Hz, which is what DMA measures. E′ at 23 °C
  (~20 MPa) is ~30 % above the quasi-static D412 modulus. v0 uses the
  quasi-static 15 MPa; a `dynamic` toggle switching to E′(T) comes with
  the temperature input

**What E changes.** With prescribed travel, the displacement field
doesn't depend on E, so contact pattern and strains at a given *travel*
are the same for any E; forces scale with E. With a force target, a
stiffer material travels less, engages less of the footbed and outsole,
and so strains at a given *force* do change with E. They don't scale
in proportion, because contact spreads nonlinearly.

### 6.3 Supports: ground (`fea/solve.ts`)

The outsole stands on a rigid floor at the lowest point of the lattice
(y = −13.0 mm in the reference file). The ground is a second contact
surface, handled by the same active set as the compressor (§6.4). Each
outsole node has a gap to the floor, and a node in contact is held in
all three translations (stick). Rotations stay free.

This is in v0, not later, because of what the prototype showed (§6.7).
The outsole is a rocker: only the middle (z from −65 to +98 mm) is within
0.5 mm of the floor. If just those nodes are fixed, the toe and heel
hang free and the compressor can't load them. As the outsole flattens,
more of it touches down, and that growing footprint is a large part of
the stiffness.

### 6.4 Load: the compressor (`fea/solve.ts`)

The compressor is rigid and moves only in −Y, by travel δ. A lattice
node under its footprint with initial gap g is in contact when δ ≥ g.
In contact, the node's uy is held at −(δ − g), and with stick its ux and
uz are held at 0 too. Floor contacts are the same with the floor's gap.

Contacts are imposed as **penalty springs** on the held dofs, 1e8 × the
dof's own stiffness, which holds a contact to ~1e-8 of its prescribed
displacement (the measured violation is ~1e-11 m and is reported). The
point of penalties rather than eliminating dofs: a contact change only
changes the diagonal, which the factor absorbs as a rank-1 update
(§6.5).

Contact is one-sided: the compressor and floor push and can't pull. Each
load step runs an **active-set loop**:

1. **start set:** on the first step, every node whose gap has closed; on
   later steps, the previous step's set plus the nodes that the
   previous solution, scaled by the travel ratio, puts through either
   surface. Starting from every closed gap instead re-adds hundreds of
   nodes released in earlier steps, and costs several refactors a step
2. solve, then compute the constraint force on each contact node (K u)
3. **release** contacts that pull, the most-pulling first. All of them go
   in one pass by default, but when more than 10 % of a pass's releases
   come back through the surface the next pass releases half as many,
   doubling back once re-entries fall under 2 %. Releasing everything at
   once oscillated; releasing a fixed quarter took 30+ passes
4. **add** free nodes that have passed through either surface (> 1 µm)
5. repeat until nothing changes. A node that has changed state three
   times in a step is held where it is (anti-cycling) and counted. A
   warning is raised only past 1 % of contacts or at the pass cap (30)

On the reference shoe this settles in 4–13 passes a step, with 0–10 of
~1,800 contacts held by the anti-cycling rule.

*Tried and dropped:* a third, sliding state (stick → normal-only →
free), on the reasoning that under Coulomb friction a contact with no
normal force can't hold a tangential one. It stopped the cycling but
needed 50+ passes and ended with ~40 % of contacts sliding, which drifts
from the stick condition the study asks for. Staged release fixed the
cycling without it. The code keeps it behind an option (`slip`).

The compressor starts 2 mm clear of the footbed, as modelled. That gap
is deliberate (no collision at the start) and needs no adjusting:
stepping begins at the smallest gap, so no solves are spent on empty
travel.

**Stepping:** the first step is 0.3 mm past first contact; each next
step aims at the next force target (every 0.5 BW) using the slope of the
last step, with the travel increment capped at 0.3 mm. The cap matters:
the curve stiffens ~3× over the first millimetre, so an uncapped
secant from the first step jumped from 56 N to 1,088 N, and the slider
then interpolated across a span that isn't close to straight (it
under-read peak strain at 1 BW by ~15 %). Capped, the reference shoe
takes 8 steps to 2.5 BW.

The target is set on a **slider from 0.5 to 2.5 × body weight** (step
0.1) for a body mass in the sidebar (default 75 kg: 368–1,839 N), with
the force in N shown beside it. Tick marks label the reference loads:
0.5 standing on two feet, 1.0 standing on one, ~1.2 walking heel
strike, ~2.5 running heel strike. One run steps to the slider's maximum
and streams each step to the UI as it's solved; moving the slider then
interpolates linearly between the two solved steps around the target
(`fea/results.ts`). Changing material doesn't re-solve either: K ∝ E
with ν fixed, so at a given travel the displacements, contact set and
strains are unchanged and forces scale with E. Changing diameters or
geometry marks the result stale; a target past the solved range says
so.

### 6.5 Assembly & solve (`fea/model.ts`, `fea/order.ts`, `fea/cholesky.ts`)

- K is assembled into **node-block sparse rows** (6×6 blocks, both
  triangles stored, so a matvec is one pass).
- **Direct solve.** Nodes are ordered by **geometric nested dissection**
  (George 1973: split at the median of the longest extent, separator
  last, recursively). The factor is a left-looking **block Cholesky**
  with dense 6×6 kernels.
- **Rank-1 updates.** Each contact change is a rank-1 update or downdate
  of the factor along one elimination-tree path (Davis & Hager 1999;
  CSparse `cs_updown`). Before each pass the solver times both options
  and picks the cheaper: updates for a few hundred dofs, a refactor
  beyond that.
- Runs in a **Web Worker** (`fea/worker.ts`); the UI never imports the
  solver directly.

**Why not conjugate gradients, as first planned.** Measured on the
reference shoe (113k DOF, in Python first):

| approach | result |
|---|---|
| CG, block-Jacobi preconditioner | 2,364 iterations per solve (~6 s in scipy) |
| … warm-started from the previous pass or step | 1,900–2,300 iterations: barely helps, and a run is ~100 solves |
| CG, incomplete LU | doesn't converge (non-symmetric preconditioner) |
| CG, two-level aggregation (rigid-body coarse space) | 100–200 iterations, but needs a large coarse solve or a full multigrid hierarchy |
| banded (RCM) Cholesky | 1.2 GB: out |
| nested-dissection block Cholesky | ~620k blocks (~170 MB), 4.6 s per factorization in Node |
| rank-1 update of that factor | 4.6 ms per dof |

**Size and time:** the reference shoe is 18,831 nodes, 30,683 struts,
112,986 DOF. One solve with the factor is 0.1 s, a matvec 16 ms. A full
run to 2.5 BW takes ~95 s in headless Chromium (8 steps, ~14
factorizations, ~5,000 updates); the first step shows after ~27 s.
Factorization dominates, so a supernodal kernel or WASM is the next
speed-up (§12). Skipping the chain simplification would make it ~570k
DOF.

### 6.6 Checks

Caught up front with a plain message: no lattice nodes under the
compressor. A factor that isn't positive definite (nothing holding the
lattice) stops the run with a message. After solving, each step reports:
reaction balance (compressor force against floor reaction), the residual
on free dofs relative to the constraint forces, the largest contact
violation, passes, and contacts held by anti-cycling.

### 6.7 Prototype check on the reference shoe

Before fixing the design, a throwaway Python prototype (numpy / scipy,
not part of the repo) ran this exact pipeline on the supplied files:
clean → Timoshenko frame → compressor and ground contact with stick →
linear solve. The settings were d = 1.5 mm, EPU 46 (E = 15 MPa,
ν = 0.49), whole lattice, 75 kg body. The numbers are indicative, not
validated, but they set the defaults and the order of work.

Model: 18,831 nodes, 30,683 struts, 112,986 DOF (the phase 1 cleaning,
bowed skin edges kept to 0.05 mm); assembly ~2.4 s, ~4 s per direct
solve.

| load | force | travel past first contact | contact nodes (compressor / ground) | fibre strain p95 / p99 / max | struts over 20 % |
|---|---|---|---|---|---|
| 0.5 BW | 368 N | 0.64 mm | 643 / 535 | 1.3 / 4.6 / 9.6 % | 0 |
| 1.0 BW | 736 N | 0.98 mm | 764 / 653 | 3.3 / 7.6 / 15.4 % | 0 |
| 1.5 BW | 1,104 N | 1.26 mm | 841 / 751 | 5.5 / 10.2 / 20.3 % | 2 |
| 2.0 BW | 1,472 N | 1.52 mm | 911 / 812 | 7.6 / 12.6 / 24.7 % | 12 |
| 2.5 BW | 1,839 N | 1.75 mm | 953 / 861 | 9.4 / 14.8 / 28.7 % | 36 (0.12 %) |

An earlier run that wrongly made every skin edge straight (20,956
struts on 9,104 nodes) gave nearly the same curve: 0.97 mm at 1 BW,
32 struts over 20 % at 2.5 BW. Under this load the force goes mainly
through the straight midsole struts, so the bowed skins barely change
it. They'll matter more for loads that stretch the skins.

Stiffness rises from ~700 N/mm just after first contact to ~1,600 N/mm
at 2.5 BW, as contact spreads across the footbed and the rocker outsole
flattens onto the ground.

What this changed:

1. **Ground contact is in v0** (§6.3). With the ground fixed in a 0.5 mm
   band, the toe and heel never engaged and the stiffness stayed
   constant. With ground contact it stiffens as the rocker flattens,
   which is the real behaviour.
2. **The contact loop needs safeguards** (§6.4). Compressor-only
   contact converged in 11–13 passes. With both surfaces it converged up
   to ~1 BW, then often cycled to the pass cap. The total force was
   steady across the cycling, so the results are usable, but cycling has
   to be handled rather than left to luck.
3. **Linear holds over the whole slider range, with a few exceptions to
   watch.** With EPU 46 even 2.5 BW keeps 99 % of struts under 15 %
   strain. The 20 % flag catches a handful of hot struts (2 at 1.5 BW,
   36 at 2.5 BW), and those, not the lattice as a whole, are where the
   linear answer is in doubt. (An earlier run with a softer 7.85 MPa
   estimate put 634 struts over 20 % at ~2.3 BW. The real modulus
   matters.)
4. **Speed matters.** A run is ~10 steps × 10–25 passes, so per-pass
   solve time sets the experience. That is what led to the direct solver
   with rank-1 updates (§6.5).

The TypeScript solver (phase 4) reproduces these numbers: 0.981 mm past
first contact at 1 BW with peak fibre strain 15.4 % and p99 7.6 %, and
36 struts over 20 % at 2.5 BW.

---

## 7. Results: definitions

| result | definition |
|---|---|
| force-displacement | total compressor force vs. travel δ, one point per step, contact-node count alongside |
| stiffness | slope of the force-displacement curve once all contacts have engaged (N/mm); the headline number for comparing lattices |
| mass | strut volume × material density (g); with stiffness, the other headline number when comparing lattices or materials |
| displacement | per node, magnitude and components (mm); max, and the footbed's vertical deflection map |
| axial force | N per strut, + tension; the signed field is the clearest map of load paths |
| bending moment | resultant √(My²+Mz²), max of the two ends |
| peak fibre strain | max over both ends of (\|N\|/A + M/Z) / E (Z = πd³/32), the largest strain on the strut's surface. The primary strut check for an elastomer. Ignores the concentration at the junction (§13) |
| linear-limit flag | struts whose peak fibre strain exceeds the linear limit (default 20 %); count, share of struts, and where they are |
| surface stress | E × peak fibre strain; shown for load paths, not compared with tensile strength (§6.2) |
| stretch / bending split | share of strain energy in axial vs. bending terms, per strut, per group and in total |
| contact pressure | each contact node's force spread over its tributary area on the compressor (the compressor's area split between contacting nodes by nearest node), drawn on the compressor surface (kPa). This is the plantar pressure map the lattice would produce under a flat-footed load |
| ground reactions | per ground node, summed; must balance the compressor force |
| per-region | the summary split into heel / midfoot / forefoot by Z thirds of the compressor's length (editable boundaries): force share, peak pressure, local stiffness |
| per-group | peak and p99 fibre strain, linear-limit count and strain energy for `cross`, `baseForm`, `baseForm inner`, connectors |
| Euler check (proxy) | per compressed strut, \|N\| / (π²EI / L²); flags struts likely to buckle. Status `proxy`: lattice buckling is a global eigenproblem (§12) |

---

## 8. Interface

Same shell as `human_data_capture`: toolbar, left sidebar, central stage
with a corner-tick frame, right tabbed panel, and a strip under the stage.

```
┌ toolbar: wordmark · fea_sim · model readout · status · open · export ──────┐
├──────────────┬──────────────────────────────────────┬──────────────────────┤
│ geometry     │                                      │ results│charts│model │
│  lattice.obj │        3d stage (three.js)           │                      │
│  compressor  │   undeformed (hairline) · deformed   │  tables / charts     │
│ groups → d   │   struts coloured by result field    │                      │
│ material     │   compressor (translucent) · ground  │                      │
│ load         ├──────────────────────────────────────┤                      │
│ display      │ field · deform scale · step scrub    │                      │
└──────────────┴──────────────────────────────────────┴──────────────────────┘
```

- **Sidebar blocks** (`.block` / `.block__head`, as in
  `human_data_capture`):
  - *geometry*: lattice and compressor files, with the clean report
    (`welded 2 · deduped 53,593 · 30,683 struts / 18,831 nodes · dropped 0`)
  - *groups*: one row per group with diameter (mm), include toggle and
    count. The group names come from the file; the unnamed group shows
    as `(no group)`
  - *material*: EPU 46 / Soft / Extra Soft, IPA-wash toggle, datasheet
    values (E, tensile strength, elongation at break, Shore A, density)
    editable; ν; linear strain limit (20 %)
  - *load*: the force slider (0.5–2.5 × BW, force in N beside it), body
    mass, friction, and **solve** / **cancel** with a one-line state
    (steps solved, or why the result is stale)
  - *display*: layers (lattice, undeformed ghost, compressor, contact
    nodes, start gaps, grid), and a **hide above** height slider: until
    the section plane lands in phase 3, cutting at ~2 mm (just above the
    footbed) is how to see the midsole
- **Stage:** struts as one `InstancedMesh` of cylinders (one draw call for
  all 21k struts), coloured per instance. The undeformed lattice stays as
  bone hairlines (`--mx-bone-16`) under the deformed one, like the ghost
  layer in `human_data_capture`. The compressor is drawn translucent at
  its current travel, and switches to the contact pressure map when that
  field is selected. A **section plane** (X or Z, draggable) is essential
  here. The midsole is hidden inside the upper and skins, so slicing is
  how anyone sees it.
- **Under-stage strip** (replaces the gait timeline, built in phase 4):
  result field (displacement, fibre strain, axial force), deformation
  magnification (1, 2, 5, 10×; the compressor moves with it so it meets
  the deformed footbed), the colour legend with its numeric scale, and a
  readout of force and travel. The struts are hairlines coloured per
  vertex for now; instanced cylinders come with phase 3.
- **Right panel tabs:**
  - `results`: summary table (stiffness, max travel and force, max
    displacement, peak fibre strain and linear-limit count, reaction
    balance, contact convergence, solver stats) and the per-region and
    per-group tables
  - `charts`: force-displacement curve, fibre-strain histogram per group,
    strain-energy split by group
  - `model`: node / strut / group counts, the clean report in full, strut
    length distribution per group
- **Toolbar status:** machine-terse, as in `human_data_capture`: `ready`,
  `cleaning...`, `solving step 4/10...`, `solved 2.1 s · 7 steps`.

### Colour

Reuse `human_data_capture`'s `core/colormap.ts` unchanged. Its diverging
ramp around a near-black zero fits FEA directly:

- **signed fields** (axial force, stress): compression → cool
  (navy → blue → mint), tension → warm (maroon → red → blush), zero fuses
  with the void. The scale is symmetric about zero.
- **magnitude fields** (displacement, fibre strain, contact pressure): the
  warm half only, black → blush, 0 → max.

Coral stays an indicator (selected group, hovered strut, focus), never a
data colour. Struts past the linear limit get a white outline, not coral. The legend
always shows the numeric scale, because colours aren't comparable
between solves without it.

### Visual rules (from `MORPHXGEN-visual-language.md`)

All lowercase, `#222` void, bone ink, hairline grids, square corners,
corner-tick frame, no shadows, mechanical easing, no emoji. Studies and
exports are named like files: `20261002_exported_lines.d1.5.epu46.1bw`,
`..._fd.csv`. Copy `src/styles/tokens.css` verbatim; port the `app.css`
layout, `.btn`, `.block`, `.tabs`, `.mtable`, `.tick` and the view cube.

---

## 9. Exports

| file | contents |
|---|---|
| `*.study.json` | the Study (diameters, material, load, ground) plus the source files' names and hashes, so a result can be reproduced |
| `*_fd.csv` | force-displacement curve |
| `*_struts.csv` | per strut: group, end nodes, length, d, N, M, peak fibre strain, stress |
| `*_nodes.csv` | per node: position, displacement, contact force |
| `*_deformed.obj` | the deformed lattice as polylines, same groups, so it opens back in Houdini |
| `*_pressure.obj` | the compressor with per-vertex colour from contact pressure |

---

## 10. Proposed layout

```
src/core/       types, colormap (from human_data_capture)
src/io/         obj.ts (points, polylines, triangles, groups), export.ts,
                index.ts router
src/lattice/    clean.ts (weld, dedupe, simplify, connectivity, report)
src/contact/    surface.ts (xz grid, ray cast, gaps, tributary areas)
src/fea/        element.ts, model.ts (node-block K), order.ts (nested
                dissection), cholesky.ts (factor, solve, rank-1),
                solve.ts (contact steps, recovery), input.ts, results.ts
                (slider interpolation), worker.ts + client.ts
src/study/      study.ts (Study, defaults, body-weight slider), ground.ts
src/materials/  library.ts
src/scene/      Viewport.tsx (instanced struts, compressor, section plane),
                ViewCube.tsx (port)
src/ui/         Toolbar, Sidebar, ResultsPanel, ChartsPanel, ModelPanel,
                FieldStrip, charts/
src/styles/     tokens.css (verbatim copy) + app.css
tests/          vitest; small OBJs built in-test. tests/fixtures/local/
                (gitignored) holds the reference shoe for reference.test.ts
```

---

## 11. Build phases

Each phase ends with something that runs and a test that proves it.

| phase | work | exit test |
|---|---|---|
| **0. scaffold** | Vite + React + TS + three.js; tokens.css, app.css shell, toolbar, empty sidebar/stage/panel; deploy workflow | builds and deploys to Pages with the MORPHXGEN shell. **Done** (deploys once merged to `main`) |
| **1. import + clean** | `io/obj.ts`, `lattice/clean.ts`, `contact/surface.ts` | Vitest on small fixtures (two cells sharing an edge, a subdivided strut, a floating strut). On the reference shoe: 30,683 struts / 18,831 nodes, 1 piece, 53,593 duplicates removed, 2 welds, first contact at 1.98 mm, nothing interpenetrating. **Done** (a basic line view of the model ships with it, ahead of phase 3) |
| **2. element + solver core** | `element.ts` (Timoshenko frame), `model.ts`, `order.ts`, `cholesky.ts` | Vitest: cantilever tip δ = PL³/3EI + PL/κGA in two planes and at an arbitrary angle, axial PL/EA, torsion TL/GJ, fixed-fixed beam, an L-frame, all within 0.1 %; a four-element strut matches one element; the factor solves to 1e-9 and rank-1 updates match a fresh factor. **Done.** The CG benchmark was replaced by the direct solver after measurement (§6.5) |
| **3. stage** | OBJ geometry on the stage, instanced struts, group colours, compressor, section plane, view cube port | the reference shoe renders at 60 fps with all 21k struts |
| **4. contact + worker** | compressor and ground contact (stick), active set with the §6.4 safeguards, force-target stepping, worker solve; deformed shape and fields | Vitest: braced columns under a compressor give F = n·EA/L · (δ − g) with balanced reactions; an unreached node stays free; stepping reaches the target force; one reference-shoe step converges with balanced reactions. In the browser the reference shoe runs to 2.5 BW in ~95 s without blocking the UI and matches the prototype (§6.7). **Done**, with results/charts tabs and the field strip ahead of phase 5 |
| **5. results + exports** | results / charts / model tabs, contact pressure map, per-region and per-group tables, exports | reaction balance < 0.1 % of applied force; `_deformed.obj` re-imports with the same topology |

Phases 1 and 2 have no UI dependency and can run alongside 0 and 3.

---

## 12. Roadmap

**v1: closer to the physical test**
- node stiffening: a rigid zone at each strut end sized from the joint;
  printed nodes make stubby lattices stiffer than bare struts
- temperature input and `dynamic` toggle: E from the digitised DMA
  curve (§6.2)
- measured material: fit E to a compression test of a printed EPU 46
  lattice coupon, replacing the datasheet modulus
- per-strut diameters from the file. OBJ can't carry them, so this means
  reading Houdini's JSON `.geo` export (point attributes like `pscale`
  and named groups come through directly), or a CSV sidecar
- compressor tilt or an off-centre load (heel strike, toe-off) as a
  rigid-body rotation as well as a travel

**v2: large deformation**
- geometric nonlinearity: corotational beam with load stepping, struts
  re-subdivided (2–4 elements each) so they can bow. The prototype keeps
  most struts under 20 % strain up to 2.5 BW (§6.7), but the hot struts
  and anything softer or thinner need it
- linear buckling: lowest eigenvalues of (K + λ K_G), mode shapes on the
  stage
- hyperelastic struts: Mooney-Rivlin or Yeoh fitted to the datasheet
  tensile curve (stress at 50 / 100 / 200 % and break are given). A Yeoh
  fit is the likely choice, since it captures both the early softening
  and the upturn past ~100 %

**v3: performance & comparison**
- faster factorization: a supernodal kernel (dense column panels under
  the nested-dissection separators) or the factor in WASM; it is ~70 %
  of a run today
- solver in WASM or WebGPU if models grow well past ~100k DOF
- several studies per lattice, saved in IndexedDB; side-by-side
  comparison of force-displacement curves and pressure maps
- PDF/HTML report export

**v4: links to `human_data_capture`**
- load cases from gait: estimated GRF peaks and timing as compressor
  force and position (heel strike → forefoot)
- compare the contact pressure map against a measured or estimated
  plantar pressure distribution

---

## 13. Known limitations (to state in the UI and README)

- **Linear, small displacement, on an elastomer.** On the reference
  shoe in EPU 46, 99 % of struts stay under 15 % strain up to 2.5 BW.
  Struts over the 20 % limit are counted and marked, and the summary
  says when any exist. A softer material, thinner struts or a
  heavier load moves more struts past the limit; those cases need v2.
- **E is a quasi-static room-temperature datasheet value** (EPU 46
  D412, 0.8 mm specimen). Real stiffness rises ~30 % at gait rates and
  roughly doubles at 0 °C (DMA, §6.2), and printed 1.5 mm struts may
  differ from test specimens. Stiffness is proportional to E, so a
  printed lattice coupon tested at the use temperature is the best
  calibration.
- **No time dependence.** Compression set (26 % after 72 h at 25 %
  compression, 23 °C) and hysteresis (36 % resilience) are outside a
  static model.
- Junctions are points. Real printed nodes add material and stiffness
  and concentrate stress, so stiffness of stubby struts (L/d < ~5, which
  is most of this lattice) is underpredicted, and peak stresses at nodes
  are not captured. Results are for comparing designs, not certifying
  parts.
- One diameter per group until v1; printed diameters also vary from
  nominal (often 10 % or more, and with build angle).
- The compressor is rigid. A real foot or test platen spreads load
  differently.
- Contact is node-based: a compressor surface touching the middle of a
  strut does nothing until it reaches a node. With footbed struts ~4 mm
  long under a smooth surface, this matters little.
- The Euler check is per strut; global and cell-level buckling need the
  v2 eigen solve.
- Between solved steps (every ~0.5 BW, at most 0.3 mm of travel apart)
  the slider interpolates linearly. Contact makes the response
  piecewise, so values between steps are close but not solved; the
  results tab says which two steps it is between.
- A node that comes into stick contact mid-step is held at its original
  x, z, not where it was when it touched. With sub-millimetre lateral
  motion this is small, but it isn't true sticking history.

---

## 14. Decisions and open questions

Decided (§4.1):
- 1.5 mm struts in every group
- Carbon EPU 46 from Carbon's technical datasheet (doc #121997-01 Rev A)
- force-controlled load on a 0.5–2.5 × body weight slider, 75 kg body
  mass
- 20 % peak fibre strain as the linear limit
- the 2 mm start gap stays; the whole lattice; stick on both surfaces

Still open (defaults are in place):

1. **Printed modulus.** A compression test of a printed EPU 46 lattice
   coupon would show how far the 1.5 mm struts are from the bulk 15 MPa.
