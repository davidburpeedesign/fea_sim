/**
 * File router: one OBJ is either a lattice (polylines) or a compressor
 * (faces). Which one is decided by content, not file name, so any naming
 * works. Files are in millimetres (Houdini's default here); everything
 * leaving this module is in metres.
 */
import type { Indenter, Lattice } from '../core/types';
import { parseObj } from './obj';
import { cleanLattice } from '../lattice/clean';
import { buildIndenter } from '../contact/surface';

export const ACCEPT = '.obj';
export const FILE_SCALE = 1e-3;

export type Imported =
  | { kind: 'lattice'; lattice: Lattice }
  | { kind: 'indenter'; indenter: Indenter };

export function importObjText(text: string, name: string): Imported {
  const obj = parseObj(text);
  const nLines = obj.lines.offsets.length - 1;
  const nTris = obj.triangles.length / 3;
  if (nLines > 0 && nLines >= nTris) return { kind: 'lattice', lattice: cleanLattice(obj, name, FILE_SCALE) };
  if (nTris > 0) return { kind: 'indenter', indenter: buildIndenter(obj, name, FILE_SCALE) };
  throw new Error(`${name}: no polylines or faces found`);
}

export async function importFiles(files: File[]): Promise<{ items: Imported[]; errors: string[] }> {
  const items: Imported[] = [];
  const errors: string[] = [];
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.obj')) {
      errors.push(`${f.name}: not an .obj`);
      continue;
    }
    try {
      items.push(importObjText(await f.text(), f.name));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { items, errors };
}
