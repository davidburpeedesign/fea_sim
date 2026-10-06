/**
 * Data model. Geometry (Lattice, Indenter) is separate from the Study
 * (diameters, material, ground, load) so a study can change without
 * re-importing. Inside the model everything is SI: metres, newtons,
 * pascals. Files and the UI are in millimetres; io/ converts.
 *
 * Frame: the files' own. Y up, the compressor travels in −Y.
 */

export type Vec3 = [number, number, number];

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

/** What cleaning changed. Nothing is changed silently (CLAUDE.md). */
export interface CleanReport {
  /** Raw counts from the file. */
  points: number;
  polylines: number;
  segments: number;
  /** Points merged into another point within the weld tolerance. */
  welded: number;
  weldTolerance: number;
  /** Segment occurrences dropped because the same pair was already in. */
  duplicateSegments: number;
  /** Segments whose two ends welded together. */
  zeroLengthSegments: number;
  /** Shared segments whose polylines disagreed on group; first one wins. */
  groupConflicts: number;
  /** Largest allowed distance of a simplified strut from the file's curve. */
  curveTolerance: number;
  /** Degree-2 points removed by simplifying chains between junctions. */
  collapsedPoints: number;
  /** Chains that bow beyond the curve tolerance and kept extra points. */
  curvedChains: number;
  /** Connected pieces before dropping, largest first (strut counts). */
  components: number[];
  /** Pieces dropped: everything but the largest. */
  dropped: { struts: number; nodes: number; bounds: Bounds }[];
  /** Result. */
  nodes: number;
  struts: number;
}

export interface Lattice {
  name: string;
  /** Node positions, metres, xyz flat. */
  nodes: Float64Array;
  /** Strut end nodes, flat pairs. */
  struts: Uint32Array;
  /** Index into `groups` per strut. */
  strutGroup: Uint16Array;
  /** Group labels from the file; '(no group)' for ungrouped polylines. */
  groups: string[];
  /** Source point id per node, for writing results back onto the file. */
  nodePoint: Uint32Array;
  /**
   * Source point ids along each strut, end to end (CSR), so a deformed
   * lattice can be exported with the file's own subdivision.
   */
  strutPoints: { offsets: Uint32Array; points: Uint32Array };
  bounds: Bounds;
  report: CleanReport;
}

/** Vertical gaps from lattice nodes up to the compressor. */
export interface GapReport {
  /** Nodes under the compressor's footprint and below its surface. */
  under: number;
  min: number;
  median: number;
  max: number;
  /** Nodes already through the surface (negative gap) at the start. */
  interpenetrating: number;
}

/** A rigid compressor surface. */
export interface Indenter {
  name: string;
  /** Vertex positions, metres, xyz flat. */
  positions: Float64Array;
  triangles: Uint32Array;
  bounds: Bounds;
  /** m². */
  area: number;
  /** Edges used by one triangle only: > 0 means an open sheet. */
  boundaryEdges: number;
  /** Area-weighted mean normal Y; negative means the surface faces down. */
  normalY: number;
}

export const NO_GROUP = '(no group)';
