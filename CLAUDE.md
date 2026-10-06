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
changing solver code. The repo is at the scoping stage. Build in the order
of ARCHITECTURE.md §10.

## Commands (once scaffolded)

- `npm run dev`: dev server on :5173
- `npm test`: Vitest (elements and solver vs. closed-form results)
- `npm run typecheck` / `npm run build`

Run `npm test` and `npm run typecheck` before every commit.

## Rules

- **SI inside** (m, N, Pa). mm / N / MPa only at the UI and io boundaries.
- **Keep the files' frame:** Y up, compressor travels in −Y, mm in files
  and UI. Axial force + is tension.
- **Geometry and study are separate.** Importers produce a `Lattice` and
  an `Indenter` only; diameters, material, ground and load live in a
  `Study`.
- **Cleaning is reported, never silent.** Welds, deduplicated segments,
  collapsed chains and dropped pieces all go in the `CleanReport`.
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
