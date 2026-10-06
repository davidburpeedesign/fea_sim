import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Indenter, Lattice } from './core/types';
import { importFiles } from './io/index';
import { gapReport, nodeGaps } from './contact/surface';
import { defaultStudy, targetForce, withGroups, type Study } from './study/study';
import { SolverClient } from './fea/client';
import { sweepInput, sweepTargets } from './fea/input';
import { displacementMagnitude, quantile, viewAt, type RunMeta } from './fea/results';
import type { StepResult, SweepResult } from './fea/solve';
import { diverging, magnitude } from './core/colormap';
import { Toolbar } from './ui/Toolbar';
import { Sidebar, type Layers } from './ui/Sidebar';
import { ModelPanel } from './ui/ModelPanel';
import { ResultsPanel } from './ui/ResultsPanel';
import { ChartsPanel } from './ui/ChartsPanel';
import { FieldStrip, type Field, type Legend } from './ui/FieldStrip';
import { Viewport, type Deform } from './scene/Viewport';

type Tab = 'results' | 'charts' | 'model';

/** Nodes within this of the lowest point stand on the floor (§6.3). */
const GROUND_BAND = 0.5e-3;

/** What a result depends on besides material and load (those rescale or interpolate). */
const runKey = (lat: Lattice | null, ind: Indenter | null, s: Study) =>
  lat && ind ? JSON.stringify([lat.name, lat.report.struts, ind.name, ind.triangles.length, lat.groups.map((g) => s.diameter[g])]) : '';

export function App() {
  const [lattice, setLattice] = useState<Lattice | null>(null);
  const [indenter, setIndenter] = useState<Indenter | null>(null);
  const [study, setStudy] = useState<Study>(defaultStudy);
  const [layers, setLayers] = useState<Layers>({ lattice: true, undeformed: true, compressor: true, contacts: false, gaps: true, grid: true });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const [clipY, setClipY] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('model');
  const [status, setStatus] = useState('ready');
  const [busy, setBusy] = useState(false);

  const [meta, setMeta] = useState<(RunMeta & { key: string; targets: number[] }) | null>(null);
  const [steps, setSteps] = useState<StepResult[]>([]);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [running, setRunning] = useState(false);
  const [field, setField] = useState<Field>('strain');
  const [scale, setScale] = useState(1);
  const solver = useRef<SolverClient | null>(null);
  useEffect(() => () => solver.current?.cancel(), []);

  const gaps = useMemo(() => (lattice && indenter ? nodeGaps(indenter, lattice) : null), [lattice, indenter]);
  const gapStats = useMemo(() => (gaps ? gapReport(gaps) : null), [gaps]);
  const ground = useMemo(() => {
    if (!lattice) return null;
    const y = lattice.bounds.min[1];
    let nodes = 0;
    for (let i = 1; i < lattice.nodes.length; i += 3) if (lattice.nodes[i] <= y + GROUND_BAND) nodes++;
    return { y, nodes };
  }, [lattice]);

  const clearResults = () => {
    solver.current?.cancel();
    setRunning(false);
    setMeta(null);
    setSteps([]);
    setResult(null);
  };

  const open = useCallback((files: File[]) => {
    setBusy(true);
    setStatus(`reading ${files.length} file${files.length > 1 ? 's' : ''}...`);
    // Let the status paint before parsing blocks the main thread (~1 s
    // for the reference shoe).
    setTimeout(async () => {
      const t0 = performance.now();
      const { items, errors } = await importFiles(files);
      const notes: string[] = [];
      for (const it of items) {
        if (it.kind === 'lattice') {
          const r = it.lattice.report;
          setLattice(it.lattice);
          setStudy((s) => withGroups(s, it.lattice.groups));
          setHidden(new Set());
          setClipY(null);
          notes.push(`${it.lattice.name}: ${r.struts.toLocaleString()} struts / ${r.nodes.toLocaleString()} nodes`);
          if (r.dropped.length) notes.push(`dropped ${r.dropped.length} floating piece${r.dropped.length > 1 ? 's' : ''}`);
        } else {
          setIndenter(it.indenter);
          notes.push(`${it.indenter.name}: compressor`);
        }
      }
      if (items.length) {
        clearResults();
        setLayers((l) => ({ ...l, gaps: true }));
      }
      notes.push(...errors);
      if (items.length) notes.push(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
      setStatus(notes.join(' · ') || 'ready');
      setBusy(false);
    }, 30);
  }, []);

  const solve = () => {
    if (!lattice || !gaps || !indenter) return;
    solver.current ??= new SolverClient();
    const input = sweepInput(lattice, gaps, study);
    const key = runKey(lattice, indenter, study);
    setSteps([]);
    setResult(null);
    setMeta({ E: input.E, firstContact: gapStats?.min ?? 0, key, targets: sweepTargets(study.bodyMass) });
    setRunning(true);
    setBusy(true);
    setStatus('solving...');
    const t0 = performance.now();
    solver.current
      .run(input, {
        progress: (msg) => setStatus(msg),
        step: (s, firstContact) => {
          setMeta((m) => (m ? { ...m, firstContact } : m));
          setSteps((prev) => {
            if (!prev.length) {
              setTab('results');
              setLayers((l) => ({ ...l, gaps: false }));
            }
            return [...prev, s];
          });
        },
      })
      .then((res) => {
        setResult(res);
        setStatus(`solved ${res.steps.length} steps · ${((performance.now() - t0) / 1000).toFixed(0)} s${res.warnings.length ? ` · ${res.warnings.length} warning${res.warnings.length > 1 ? 's' : ''}` : ''}`);
      })
      .catch((e: Error) => setStatus(`solve failed: ${e.message}`))
      .finally(() => { setRunning(false); setBusy(false); });
  };

  const cancel = () => {
    solver.current?.cancel();
    setRunning(false);
    setBusy(false);
    setStatus(steps.length ? `cancelled after ${steps.length} steps` : 'cancelled');
  };

  const target = targetForce(study);
  const key = runKey(lattice, indenter, study);
  const stale = meta && meta.key !== key ? 'diameters or geometry changed: solve again' : null;
  const view = useMemo(
    () => (meta && steps.length && !stale ? viewAt(meta, steps, target, study.material.E) : null),
    [meta, steps, target, study.material.E, stale],
  );

  // Strut colours and legend for the chosen field.
  const { colors, legend } = useMemo((): { colors: Float32Array | null; legend: Legend } => {
    const none = { colors: null, legend: { kind: 'magnitude' as const, lo: '', hi: '' } };
    if (!view || !lattice) return none;
    const m = lattice.struts.length / 2;
    const out = new Float32Array(m * 6);
    const put = (e: number, v: number, c: [number, number, number]) => out.set(c, 6 * e + 3 * v);
    if (field === 'displacement') {
      const d = displacementMagnitude(view.u);
      let max = 0;
      for (const x of d) max = Math.max(max, x);
      for (let e = 0; e < m; e++) for (let v = 0; v < 2; v++) put(e, v, magnitude(d[lattice.struts[2 * e + v]] / (max || 1)));
      return { colors: out, legend: { kind: 'magnitude', lo: '0', hi: `${(max * 1e3).toFixed(2)} mm` } };
    }
    if (field === 'strain') {
      // Full colour at the linear limit; past it, white (§8).
      const lim = study.strainLimit;
      for (let e = 0; e < m; e++) {
        const c: [number, number, number] = view.strain[e] > lim ? [1, 1, 1] : magnitude(view.strain[e] / lim);
        put(e, 0, c); put(e, 1, c);
      }
      return { colors: out, legend: { kind: 'magnitude', lo: '0', hi: `${(lim * 100).toFixed(0)} %`, over: 'over the limit' } };
    }
    // Axial: symmetric about zero at the p99 magnitude, so a few hot
    // struts don't wash out the rest.
    const a = quantile(Array.from(view.axial, Math.abs), 0.99) || 1;
    for (let e = 0; e < m; e++) {
      const c = diverging(view.axial[e] / a);
      put(e, 0, c); put(e, 1, c);
    }
    return { colors: out, legend: { kind: 'diverging', lo: `−${a.toFixed(2)} n compression`, hi: `+${a.toFixed(2)} n tension` } };
  }, [view, lattice, field, study.strainLimit]);

  const deform = useMemo((): Deform | null => {
    if (!view) return null;
    const c = view.nearest.compressorContact, g = view.nearest.groundContact;
    const contacts = new Uint8Array(c.length);
    for (let i = 0; i < c.length; i++) contacts[i] = c[i] || g[i];
    return { u: view.u, scale, travel: view.delta - view.firstContact, firstContact: view.firstContact, contacts };
  }, [view, scale]);

  const readout = lattice
    ? `${lattice.report.struts.toLocaleString()} struts · ${(lattice.report.nodes * 6).toLocaleString()} dof`
    : '';
  const solvedNote = result
    ? `${result.steps.length} steps to ${(result.steps[result.steps.length - 1].force / (study.bodyMass * 9.81)).toFixed(1)} × bw`
    : running ? `${steps.length} step${steps.length === 1 ? '' : 's'} so far` : 'not solved yet';

  return (
    <div className="app">
      <Toolbar readout={readout} status={status} busy={busy} onOpen={open} />
      <main className="main">
        <Sidebar
          lattice={lattice}
          indenter={indenter}
          study={study}
          onStudy={setStudy}
          layers={layers}
          onLayers={setLayers}
          hidden={hidden}
          onHidden={setHidden}
          hoverGroup={hoverGroup}
          onHoverGroup={setHoverGroup}
          clipY={clipY}
          onClipY={setClipY}
          solve={{
            can: !!(lattice && indenter && gapStats?.under),
            running,
            stale: stale ?? (view?.clamped && !running ? 'target is beyond the solved range: solve again' : null),
            note: solvedNote,
          }}
          onSolve={solve}
          onCancel={cancel}
        />
        <section className="stage">
          <Viewport
            lattice={lattice}
            indenter={indenter}
            gaps={gaps}
            deform={deform}
            colors={colors}
            layers={layers}
            clipY={clipY}
            hidden={hidden}
            hoverGroup={hoverGroup}
            onDrop={open}
          />
          {view && (
            <FieldStrip
              field={field}
              onField={setField}
              scale={scale}
              onScale={setScale}
              legend={legend}
              readout={`${view.force.toFixed(0)} n · ${((view.delta - view.firstContact) * 1e3).toFixed(2)} mm past contact${view.clamped ? ' · beyond solved range' : ''}`}
            />
          )}
        </section>
        <aside className="panel">
          <nav className="tabs">
            {(['results', 'charts', 'model'] as const).map((t) => (
              <button
                key={t}
                className={t === tab ? 'tab tab--on' : 'tab'}
                disabled={t !== 'model' && !view}
                title={t !== 'model' && !view ? 'solve first' : undefined}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="panel__body">
            {tab === 'model' && (
              <ModelPanel lattice={lattice} indenter={indenter} gaps={gapStats} ground={ground} study={study} />
            )}
            {tab === 'results' && view && meta && lattice && (
              <ResultsPanel
                view={view}
                result={result ?? { steps, firstContact: meta.firstContact, E: meta.E, dof: lattice.report.nodes * 6, factorBlocks: 0, factorizations: 0, updates: 0, ms: 0, warnings: [] }}
                lattice={lattice}
                study={study}
                target={target}
                running={running}
              />
            )}
            {tab === 'charts' && view && meta && (
              <ChartsPanel steps={steps} firstContact={meta.firstContact} scale={study.material.E / meta.E} view={view} targets={meta.targets} />
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
