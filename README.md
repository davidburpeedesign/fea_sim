# fea_sim

A browser tool for simple deformation analysis of lattice beam models.
Load a lattice exported as a curve network (OBJ polylines) and a
compressor surface (OBJ triangles), press the compressor into the lattice,
and solve it as a 3D Timoshenko frame with contact. The tool shows the
deformed shape, strut forces and stresses, the force-displacement curve
and the contact pressure map. It doesn't generate lattices: all geometry
comes from Houdini. Everything runs client-side.

**Status: scoping.** Nothing is built yet. [ARCHITECTURE.md](./ARCHITECTURE.md)
has the scope, solver design, interface and build phases.
[MORPHXGEN-visual-language.md](./MORPHXGEN-visual-language.md) is the
visual system, shared with
[human_data_capture](https://github.com/davidburpeedesign/human_data_capture).

Planned commands (same as human_data_capture):

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # element + solver verification (vitest)
npm run build      # typecheck + production bundle → dist/
```
