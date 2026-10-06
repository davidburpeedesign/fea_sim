import type { Indenter, Lattice } from '../core/types';
import { MATERIALS } from '../materials/library';
import { BW_RANGE, BW_TICKS, targetForce, type Study } from '../study/study';

export interface Layers {
  lattice: boolean;
  undeformed: boolean;
  compressor: boolean;
  contacts: boolean;
  gaps: boolean;
  grid: boolean;
}

interface Props {
  lattice: Lattice | null;
  indenter: Indenter | null;
  study: Study;
  onStudy: (s: Study) => void;
  layers: Layers;
  onLayers: (l: Layers) => void;
  hidden: Set<string>;
  onHidden: (h: Set<string>) => void;
  hoverGroup: string | null;
  onHoverGroup: (g: string | null) => void;
  /** Height clip, m; null = off. */
  clipY: number | null;
  onClipY: (y: number | null) => void;
  /** Solve state for the button: why it can't run, or what it's doing. */
  solve: { can: boolean; running: boolean; stale: string | null; note: string };
  onSolve: () => void;
  onCancel: () => void;
}

const mm = (m: number) => +(m * 1e3).toFixed(3);
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function Sidebar(p: Props) {
  const { lattice, indenter, study } = p;
  const counts = new Map<string, number>();
  if (lattice) for (const g of lattice.strutGroup) counts.set(lattice.groups[g], (counts.get(lattice.groups[g]) ?? 0) + 1);
  const span = BW_RANGE.max - BW_RANGE.min;

  return (
    <aside className="sidebar">
      <section className="block">
        <header className="block__head"><span>geometry</span></header>
        <ul className="list">
          <li className={lattice ? 'item item--on' : 'item'}>
            <span className="item__marker" />
            <span className="item__body">
              <span className="item__name">{lattice?.name ?? 'lattice: none'}</span>
              <span className="item__desc">
                {lattice
                  ? `${lattice.report.struts.toLocaleString()} struts · ${lattice.report.nodes.toLocaleString()} nodes`
                  : 'polylines (obj l)'}
              </span>
            </span>
          </li>
          <li className={indenter ? 'item item--on' : 'item'}>
            <span className="item__marker" />
            <span className="item__body">
              <span className="item__name">{indenter?.name ?? 'compressor: none'}</span>
              <span className="item__desc">
                {indenter
                  ? `${(indenter.triangles.length / 3).toLocaleString()} tris · ${(indenter.area * 1e6).toFixed(0)} mm²`
                  : 'triangles (obj f)'}
              </span>
            </span>
          </li>
        </ul>
      </section>

      {lattice && (
        <section className="block">
          <header className="block__head"><span>groups</span><span className="muted">d mm</span></header>
          <div className="grows">
            {lattice.groups.map((g) => (
              <div key={g} style={{ display: 'contents' }}>
                <label
                  className={p.hoverGroup === g ? 'grows__name grows__name--on toggle' : 'grows__name toggle'}
                  onMouseEnter={() => p.onHoverGroup(g)}
                  onMouseLeave={() => p.onHoverGroup(null)}
                >
                  <input
                    type="checkbox"
                    checked={!p.hidden.has(g)}
                    onChange={() => {
                      const h = new Set(p.hidden);
                      if (h.has(g)) h.delete(g); else h.add(g);
                      p.onHidden(h);
                    }}
                  />
                  {g}
                </label>
                <span className="grows__count">{(counts.get(g) ?? 0).toLocaleString()}</span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={mm(study.diameter[g] ?? 0)}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (v > 0) p.onStudy({ ...study, diameter: { ...study.diameter, [g]: v * 1e-3 } });
                  }}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <header className="block__head"><span>material</span><span className="muted">{study.material.source}</span></header>
        <div className="fields">
          <select
            className="fields__wide"
            value={study.material.id}
            onChange={(e) => p.onStudy({ ...study, material: MATERIALS.find((m) => m.id === e.target.value)! })}
          >
            {MATERIALS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <label>e</label><span className="num">{(study.material.E / 1e6).toFixed(1)} mpa</span>
          <label>tensile strength</label><span className="num">{(study.material.tensileStrength / 1e6).toFixed(0)} mpa</span>
          <label>elongation at break</label><span className="num">{pct(study.material.elongationAtBreak)}</span>
          <label>shore a</label><span className="num">{study.material.shoreA}</span>
          <label>density</label><span className="num">{(study.material.density / 1e3).toFixed(2)} g/ml</span>
          <label>linear limit</label>
          <span className="num">
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={Math.round(study.strainLimit * 100)}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (v > 0) p.onStudy({ ...study, strainLimit: v / 100 });
              }}
            />{' '}%
          </span>
          {study.material.note && <span className="fields__wide muted">{study.material.note}</span>}
        </div>
      </section>

      <section className="block">
        <header className="block__head"><span>load</span><span className="muted">force target</span></header>
        <div className="load">
          <div className="load__value">
            <span><b>{study.bw.toFixed(1)}</b> × bw</span>
            <span className="muted">{targetForce(study).toFixed(0)} n</span>
          </div>
          <input
            type="range"
            min={BW_RANGE.min}
            max={BW_RANGE.max}
            step={BW_RANGE.step}
            value={study.bw}
            onChange={(e) => p.onStudy({ ...study, bw: parseFloat(e.target.value) })}
          />
          <div className="load__ticks">
            {BW_TICKS.map((t) => (
              <span
                key={t.bw}
                className={t.row ? 'load__tick load__tick--low' : 'load__tick'}
                style={{ left: `${((t.bw - BW_RANGE.min) / span) * 100}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>
        <div className="fields">
          <label>body mass</label>
          <span className="num">
            <input
              type="number"
              min={20}
              max={200}
              step={1}
              value={study.bodyMass}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (v > 0) p.onStudy({ ...study, bodyMass: v });
              }}
            />{' '}kg
          </span>
          <label>friction</label><span className="num">stick</span>
        </div>
        <div className="block__actions solve">
          {p.solve.running
            ? <button className="btn" onClick={p.onCancel}>cancel</button>
            : <button className="btn btn--primary" disabled={!p.solve.can} onClick={p.onSolve}>solve</button>}
          <span className={p.solve.stale ? 'solve__note warn' : 'solve__note muted'}>{p.solve.stale ?? p.solve.note}</span>
        </div>
      </section>

      <section className="block">
        <header className="block__head"><span>display</span></header>
        <div className="toggles">
          {(Object.keys(p.layers) as (keyof Layers)[]).map((k) => (
            <label key={k} className="toggle">
              <input type="checkbox" checked={p.layers[k]} onChange={() => p.onLayers({ ...p.layers, [k]: !p.layers[k] })} />
              {k}
            </label>
          ))}
        </div>
        {lattice && (
          <div className="fields">
            <label>hide above</label>
            <span className="num">{p.clipY === null ? 'off' : `${(p.clipY * 1e3).toFixed(0)} mm`}</span>
            <input
              className="fields__wide"
              type="range"
              min={lattice.bounds.min[1]}
              max={lattice.bounds.max[1]}
              step={0.5e-3}
              value={p.clipY ?? lattice.bounds.max[1]}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                p.onClipY(v >= lattice.bounds.max[1] - 1e-9 ? null : v);
              }}
            />
          </div>
        )}
      </section>
    </aside>
  );
}
