/**
 * What import and cleaning did, in numbers: the CleanReport, per-group
 * strut statistics and mass, the compressor, and the start-of-run gaps.
 * The point is that nothing about the model is hidden (CLAUDE.md).
 */
import type { GapReport, Indenter, Lattice } from '../core/types';
import { strutLengths } from '../lattice/clean';
import type { Study } from '../study/study';

interface Props {
  lattice: Lattice | null;
  indenter: Indenter | null;
  gaps: GapReport | null;
  ground: { y: number; nodes: number } | null;
  study: Study;
}

function Row({ label, value, unit, warn }: { label: string; value: string | number; unit?: string; warn?: boolean }) {
  return (
    <tr className="mrow">
      <td className="mrow__label">{label}</td>
      <td className={warn ? 'num warn' : 'num'}>{typeof value === 'number' ? value.toLocaleString() : value}</td>
      <td className="mrow__unit">{unit ?? ''}</td>
    </tr>
  );
}

function Table({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <table className="mtable">
      <thead><tr><th className="mtable__group" colSpan={3}>{title}</th></tr></thead>
      <tbody>{children}</tbody>
    </table>
  );
}

const xyz = (v: readonly number[]) => v.map((x) => (x * 1e3).toFixed(1)).join('  ');

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : NaN;
};

export function ModelPanel({ lattice, indenter, gaps, ground, study }: Props) {
  if (!lattice && !indenter) return <p className="muted empty">drop the lattice and compressor .obj files on the stage...</p>;
  const r = lattice?.report;

  const groups = lattice
    ? (() => {
        const L = strutLengths(lattice);
        return lattice.groups.map((g, gi) => {
          const len: number[] = [];
          lattice.strutGroup.forEach((sg, s) => { if (sg === gi) len.push(L[s]); });
          const d = study.diameter[g] ?? 0;
          const total = len.reduce((a, b) => a + b, 0);
          return { g, n: len.length, median: median(len), total, mass: total * Math.PI * d * d / 4 * study.material.density, d };
        });
      })()
    : [];
  const mass = groups.reduce((a, b) => a + b.mass, 0);

  return (
    <div>
      {lattice && r && (
        <>
          <Table title={`lattice · ${lattice.name}`}>
            <Row label="nodes" value={r.nodes} />
            <Row label="struts" value={r.struts} />
            <Row label="dof" value={r.nodes * 6} />
            <Row label="mass" value={(mass * 1e3).toFixed(1)} unit="g" />
            <Row label="min x y z" value={xyz(lattice.bounds.min)} unit="mm" />
            <Row label="max x y z" value={xyz(lattice.bounds.max)} unit="mm" />
          </Table>
          <Table title="cleaning">
            <Row label="file points" value={r.points} />
            <Row label="file polylines" value={r.polylines} />
            <Row label="file segments" value={r.segments} />
            <Row label={`welded (≤ ${(r.weldTolerance * 1e3).toFixed(2)} mm)`} value={r.welded} />
            <Row label="duplicate segments removed" value={r.duplicateSegments} />
            <Row label="zero-length segments removed" value={r.zeroLengthSegments} />
            <Row label="shared segments, groups differ" value={r.groupConflicts} warn={r.groupConflicts > 0} />
            <Row label="points simplified away" value={r.collapsedPoints} />
            <Row label={`bowed chains (> ${(r.curveTolerance * 1e3).toFixed(2)} mm)`} value={r.curvedChains} />
            <Row label="pieces" value={r.components.length} />
            <Row label="pieces dropped" value={r.dropped.length} warn={r.dropped.length > 0} />
          </Table>
          {r.dropped.length > 0 && (
            <Table title="dropped pieces (not connected to the main body)">
              {r.dropped.slice(0, 20).map((d, i) => (
                <Row key={i} label={`${d.struts} struts · ${d.nodes} nodes`} value={`at ${xyz(d.bounds.min)}`} unit="mm" />
              ))}
            </Table>
          )}
          <table className="mtable">
            <thead>
              <tr>
                <th className="mtable__group">group</th>
                <th>struts</th>
                <th>median l</th>
                <th>d</th>
                <th>mass</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((x) => (
                <tr key={x.g} className="mrow">
                  <td className="mrow__label">{x.g}</td>
                  <td className="num">{x.n.toLocaleString()}</td>
                  <td className="num">{(x.median * 1e3).toFixed(2)} mm</td>
                  <td className="num">{(x.d * 1e3).toFixed(2)} mm</td>
                  <td className="num">{(x.mass * 1e3).toFixed(1)} g</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="chart__note muted" style={{ padding: '0 var(--sp-4)' }}>
            mass counts strut volume only, so overlap at nodes is counted twice and it reads a little high.
          </p>
        </>
      )}

      {indenter && (
        <Table title={`compressor · ${indenter.name}`}>
          <Row label="triangles" value={indenter.triangles.length / 3} />
          <Row label="area" value={(indenter.area * 1e6).toFixed(0)} unit="mm²" />
          <Row label="surface" value={indenter.boundaryEdges > 0 ? `open (${indenter.boundaryEdges} edges)` : 'closed'} />
          <Row
            label="facing"
            value={indenter.normalY < -0.5 ? 'down' : indenter.normalY > 0.5 ? 'up' : 'mixed'}
            warn={indenter.normalY > -0.5}
          />
          <Row label="min x y z" value={xyz(indenter.bounds.min)} unit="mm" />
          <Row label="max x y z" value={xyz(indenter.bounds.max)} unit="mm" />
        </Table>
      )}

      {gaps && (
        <Table title="start position">
          <Row label="nodes under the compressor" value={gaps.under} />
          <Row label="first contact after" value={(gaps.min * 1e3).toFixed(3)} unit="mm" />
          <Row label="median gap" value={(gaps.median * 1e3).toFixed(2)} unit="mm" />
          <Row label="largest gap" value={(gaps.max * 1e3).toFixed(2)} unit="mm" />
          <Row label="interpenetrating" value={gaps.interpenetrating} warn={gaps.interpenetrating > 0} />
          {ground && <Row label="floor (lowest node)" value={(ground.y * 1e3).toFixed(2)} unit="mm" />}
          {ground && <Row label="nodes within 0.5 mm of floor" value={ground.nodes} />}
        </Table>
      )}
    </div>
  );
}
