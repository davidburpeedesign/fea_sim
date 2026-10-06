/**
 * Minimal Wavefront OBJ reader for the two things fea_sim imports: polyline
 * networks (`l`) and triangle surfaces (`f`). three.js's OBJLoader isn't
 * used because it drops point indices and splits by group, and cleaning
 * needs both the shared point ids and each polyline's group.
 *
 * Values stay in file units here; io/index.ts converts to metres.
 */
import { NO_GROUP } from '../core/types';

export interface ObjData {
  /** Vertex positions in file units, xyz flat. */
  positions: Float64Array;
  /** Polylines as CSR: point ids of line i are indices[offsets[i]..offsets[i+1]). */
  lines: { offsets: Uint32Array; indices: Uint32Array; group: Uint16Array };
  /** Faces, fan-triangulated: flat vertex-id triples. */
  triangles: Uint32Array;
  /**
   * Group labels. An OBJ `g a b` puts what follows in groups a and b; the
   * label keeps the full set ("baseForm inner"), since the combination is
   * what tells parts apart (outer skin = baseForm, inner = baseForm inner).
   */
  groups: string[];
}

/** Parse one `v`, `v/vt` or `v/vt/vn` reference to a 0-based vertex id. */
function vertexRef(token: string, count: number, lineNo: number): number {
  const slash = token.indexOf('/');
  const n = parseInt(slash < 0 ? token : token.slice(0, slash), 10);
  // Negative ids count back from the latest vertex (OBJ spec).
  const id = n < 0 ? count + n : n - 1;
  if (!Number.isFinite(n) || n === 0 || id < 0 || id >= count) {
    throw new Error(`line ${lineNo}: vertex ${token} out of range (${count} vertices so far)`);
  }
  return id;
}

export function parseObj(text: string): ObjData {
  const pos: number[] = [];
  const lineOffsets: number[] = [0];
  const lineIdx: number[] = [];
  const lineGroup: number[] = [];
  const tris: number[] = [];
  const groups: string[] = [];
  const groupId = new Map<string, number>();
  let current = -1;

  const group = (label: string) => {
    let id = groupId.get(label);
    if (id === undefined) {
      id = groups.length;
      groups.push(label);
      groupId.set(label, id);
    }
    return id;
  };

  let start = 0;
  let lineNo = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = len;
    lineNo++;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (!line || line[0] === '#') continue;

    const t = line.split(/\s+/);
    switch (t[0]) {
      case 'v': {
        const x = +t[1], y = +t[2], z = +t[3];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          throw new Error(`line ${lineNo}: bad vertex "${line.slice(0, 60)}"`);
        }
        pos.push(x, y, z);
        break;
      }
      case 'l': {
        if (t.length < 3) break;
        const count = pos.length / 3;
        for (let i = 1; i < t.length; i++) lineIdx.push(vertexRef(t[i], count, lineNo));
        lineOffsets.push(lineIdx.length);
        if (current < 0) current = group(NO_GROUP);
        lineGroup.push(current);
        break;
      }
      case 'f': {
        const count = pos.length / 3;
        const ids = t.slice(1).map((s) => vertexRef(s, count, lineNo));
        for (let i = 1; i + 1 < ids.length; i++) tris.push(ids[0], ids[i], ids[i + 1]);
        break;
      }
      case 'g':
        current = group(t.length > 1 ? t.slice(1).join(' ') : NO_GROUP);
        break;
      default:
        // vn, vt, o, s, usemtl, mtllib: nothing the analysis uses.
        break;
    }
  }

  return {
    positions: Float64Array.from(pos),
    lines: {
      offsets: Uint32Array.from(lineOffsets),
      indices: Uint32Array.from(lineIdx),
      group: Uint16Array.from(lineGroup),
    },
    triangles: Uint32Array.from(tris),
    groups,
  };
}
