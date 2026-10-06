# fea_sim

A browser tool for simple deformation analysis of lattice beam models.
Load a lattice exported as a curve network (OBJ polylines) and a
compressor surface (OBJ triangles), press the compressor into the lattice,
and solve it as a 3D Timoshenko frame with one-sided contact against the
compressor and the ground. The tool shows the
deformed shape, strut forces and stresses, the force-displacement curve
and the contact pressure map. It doesn't generate lattices: all geometry
comes from Houdini. Everything runs client-side.

**Status: phases 0–1 built.** The app imports and cleans the lattice and
compressor, and shows the model, the cleaning report and the start gaps.
The solver (phases 2 and 4) is next. [ARCHITECTURE.md](./ARCHITECTURE.md)
has the scope, solver design, interface and build phases.
[MORPHXGEN-visual-language.md](./MORPHXGEN-visual-language.md) is the
visual system, shared with
[human_data_capture](https://github.com/davidburpeedesign/human_data_capture).

Commands (same as human_data_capture):

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # element + solver verification (vitest)
npm run build      # typecheck + production bundle → dist/
```

The reference-shoe test reads `tests/fixtures/local/20261002_exported_lines.obj`
and `tests/fixtures/local/compressor.obj` (gitignored) and is skipped when
they're absent.
