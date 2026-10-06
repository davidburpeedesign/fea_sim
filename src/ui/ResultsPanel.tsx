/**
 * Results at the slider's force: load, deformation, strain against the
 * linear limit, per-group strain, and the solver's own checks (residual,
 * contact violation, reaction balance). Every number shown is either
 * from a solved step or says it's interpolated between two.
 */
import type { Lattice } from '../core/types';
import type { SweepResult } from '../fea/solve';
import { displacementMagnitude, quantile, strainByGroup, type ResultView } from '../fea/results';
import type { Study } from '../study/study';
import { G } from '../study/study';

interface Props {
  view: ResultView;
  result: SweepResult;
  lattice: Lattice;
  study: Study;
  target: number;
  running: boolean;
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

const pct = (x: number, d = 1) => (x * 100).toFixed(d);

export function ResultsPanel({ view, result, lattice, study, target, running }: Props) {
  const limit = study.strainLimit;
  const disp = displacementMagnitude(view.u);
  let maxD = 0, maxDown = 0;
  disp.forEach((v, i) => { if (v > maxD) maxD = v; maxDown = Math.min(maxDown, view.u[6 * i + 1]); });
  let peak = 0, over = 0, broken = 0;
  for (const e of view.strain) { if (e > peak) peak = e; if (e > limit) over++; if (e > study.material.elongationAtBreak) broken++; }
  const groups = strainByGroup(view.strain, lattice.strutGroup, lattice.groups, limit);
  const s = view.nearest;
  const cC = s.compressorContact.filter((v) => v > 0).length, cG = s.groundContact.filter((v) => v > 0).length;
  const balance = Math.abs(s.force - s.groundForce) / Math.max(1e-12, s.force);
  const bw = study.bodyMass * G;
  const between = view.between[0] < 0 ? `unloaded and step ${view.between[1] + 1}` : `steps ${view.between[0] + 1} and ${view.between[1] + 1}`;
  const rescaled = Math.abs(study.material.E - result.E) > 1;

  return (
    <div>
      <p className="metrics__summary muted">
        {view.clamped
          ? `beyond the solved range: showing the last step (${(view.force / bw).toFixed(2)} × bw)`
          : `interpolated between ${between}`}
        {rescaled && ` · forces rescaled from e ${(result.E / 1e6).toFixed(1)} to ${(study.material.E / 1e6).toFixed(1)} mpa`}
        {running && ' · still solving'}
      </p>
      <Table title="load">
        <Row label="target" value={`${target.toFixed(0)} n · ${(target / bw).toFixed(2)} × bw`} />
        <Row label="compressor force" value={view.force.toFixed(0)} unit="n" warn={view.clamped} />
        <Row label="travel past first contact" value={((view.delta - view.firstContact) * 1e3).toFixed(3)} unit="mm" />
        <Row label="stiffness here" value={(view.stiffness / 1e3).toFixed(0)} unit="n/mm" />
        <Row label="contact nodes · compressor" value={cC} />
        <Row label="contact nodes · floor" value={cG} />
      </Table>
      <Table title="deformation">
        <Row label="max displacement" value={(maxD * 1e3).toFixed(3)} unit="mm" />
        <Row label="max downward" value={(-maxDown * 1e3).toFixed(3)} unit="mm" />
      </Table>
      <Table title={`fibre strain · linear limit ${pct(limit, 0)} %`}>
        <Row label="peak" value={pct(peak)} unit="%" warn={peak > limit} />
        <Row label="p99" value={pct(quantile(view.strain, 0.99))} unit="%" />
        <Row label="p95" value={pct(quantile(view.strain, 0.95))} unit="%" />
        <Row label="struts over the limit" value={`${over} · ${pct(over / view.strain.length, 2)} %`} warn={over > 0} />
        <Row label={`struts over break (${pct(study.material.elongationAtBreak, 0)} %)`} value={broken} warn={broken > 0} />
      </Table>
      <table className="mtable">
        <thead>
          <tr><th className="mtable__group">group</th><th>peak</th><th>p99</th><th>over limit</th></tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.group} className="mrow">
              <td className="mrow__label">{g.group}</td>
              <td className={g.peak > limit ? 'num warn' : 'num'}>{pct(g.peak)} %</td>
              <td className="num">{pct(g.p99)} %</td>
              <td className={g.over ? 'num warn' : 'num'}>{g.over}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Table title={`solver · nearest solved step (${view.nearest === result.steps[view.between[1]] ? view.between[1] + 1 : view.between[0] + 1})`}>
        <Row label="reaction balance" value={pct(balance, 4)} unit="%" warn={balance > 1e-3} />
        <Row label="residual (free dofs)" value={s.residual.toExponential(1)} warn={s.residual > 1e-6} />
        <Row label="contact violation" value={(s.violation * 1e6).toExponential(1)} unit="µm" />
        <Row label="contact passes" value={s.passes} warn={!s.converged} />
        <Row label="held by anti-cycling" value={s.frozen} />
      </Table>
      <Table title="run">
        <Row label="steps solved" value={result.steps.length} />
        <Row label="dof" value={result.dof} />
        <Row label="factor blocks (6×6)" value={result.factorBlocks} />
        <Row label="factorizations · updates" value={`${result.factorizations} · ${result.updates.toLocaleString()}`} />
        <Row label="time" value={(result.ms / 1000).toFixed(1)} unit="s" />
      </Table>
      {result.warnings.length > 0 && (
        <ul className="notes">{result.warnings.map((w, i) => <li key={i} className="warn">{w}</li>)}</ul>
      )}
    </div>
  );
}
