# CLAUDE.md

Guidance for working in this repository.

## What this is

A client-side browser tool for linear static FEA of lattice beam models.
It imports a lattice curve network (OBJ polylines) and a rigid compressor
surface (OBJ triangles) from Houdini, steps the compressor down into the
lattice with one-sided contact, solves a 3D frame model in a Web Worker,
and visualises deformation and stress. It never generates or edits
lattices.
`ARCHITECTURE.md` is the design doc and results reference; read it before
changing solver code. Build in the order
of ARCHITECTURE.md §11 (phases 0, 1, 2 and 4 are done).

## Commands

- `npm run dev`: dev server on :5173
- `npm test`: Vitest (import/cleaning fixtures; elements and solver vs.
  closed-form results; the reference shoe in `tests/fixtures/local/`,
  gitignored, when present, including one ~20 s solve step)
- `npm run typecheck` / `npm run build`

Run `npm test` and `npm run typecheck` before every commit.

## Layout

```
src/core/       types, colormap (ported from human_data_capture)
src/io/         obj.ts (parser), index.ts (router, mm → m)
src/lattice/    clean.ts (weld, dedupe, Douglas–Peucker, connectivity)
src/contact/    surface.ts (compressor, xz grid, vertical gaps)
src/fea/        element, model (node-block K), order (nested dissection),
                cholesky (factor + rank-1), solve (contact steps), input,
                results (slider interpolation), worker + client
src/materials/  library.ts (EPU 46 family, from Carbon's datasheet)
src/study/      study.ts (diameters, material, body-weight load)
src/scene/      Viewport.tsx (three.js)
src/ui/         Toolbar, Sidebar, FieldStrip, Results/Charts/ModelPanel
src/styles/     tokens.css (verbatim from human_data_capture) + app.css
tests/          vitest
```

## Rules

- **SI inside** (m, N, Pa). mm / N / MPa only at the UI and io boundaries.
- **Keep the files' frame:** Y up, compressor travels in −Y, mm in files
  and UI. Axial force + is tension.
- **Geometry and study are separate.** Importers produce a `Lattice` and
  an `Indenter` only; diameters, material, ground and load live in a
  `Study`.
- **Cleaning is reported, never silent.** Welds, deduplicated segments,
  simplified chains and dropped pieces all go in the `CleanReport`.
- **The solver never touches the DOM.** `src/fea/` is pure TS and runs in
  the worker; the UI talks to it only through `fea/worker.ts`.
- **Be honest about results.** Report solver residual and reaction
  balance. Metrics built on simplifications (e.g. the per-strut Euler
  check) are `proxy`. A non-converged solve shows an error, not a shape.
- **New element or result:** add a closed-form verification test and
  document the definition in ARCHITECTURE.md §6–7.
- **Visual language:** follow `MORPHXGEN-visual-language.md` and match
  `human_data_capture`: lowercase UI, square corners, hairlines, no
  shadows. Coral (`--accent`) is an indicator only, never a data colour.
  Result fields use the diverging ramp from `core/colormap.ts`.
- No chart, state, CSS or numeric libraries. three.js is the only heavy
  dependency.

## Style

TypeScript strict, 2-space indent, single quotes, semicolons. Comments
explain *why* (method choice, reference, pitfall), not what. Cite the
source when implementing a published method or element formulation.

## Git

Concise imperative subject, body explaining the change. Do not open PRs
unless asked.
