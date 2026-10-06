import { useCallback, useMemo, useState } from 'react';
import type { Indenter, Lattice } from './core/types';
import { importFiles } from './io/index';
import { gapReport, nodeGaps } from './contact/surface';
import { defaultStudy, withGroups, type Study } from './study/study';
import { Toolbar } from './ui/Toolbar';
import { Sidebar, type Layers } from './ui/Sidebar';
import { ModelPanel } from './ui/ModelPanel';
import { Viewport } from './scene/Viewport';

type Tab = 'results' | 'charts' | 'model';

/** Nodes within this of the lowest point stand on the floor (§6.3). */
const GROUND_BAND = 0.5e-3;

export function App() {
  const [lattice, setLattice] = useState<Lattice | null>(null);
  const [indenter, setIndenter] = useState<Indenter | null>(null);
  const [study, setStudy] = useState<Study>(defaultStudy);
  const [layers, setLayers] = useState<Layers>({ lattice: true, compressor: true, gaps: true, grid: true });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverGroup, setHoverGroup] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('model');
  const [status, setStatus] = useState('ready');
  const [busy, setBusy] = useState(false);

  const gaps = useMemo(() => (lattice && indenter ? nodeGaps(indenter, lattice) : null), [lattice, indenter]);
  const gapStats = useMemo(() => (gaps ? gapReport(gaps) : null), [gaps]);
  const ground = useMemo(() => {
    if (!lattice) return null;
    const y = lattice.bounds.min[1];
    let nodes = 0;
    for (let i = 1; i < lattice.nodes.length; i += 3) if (lattice.nodes[i] <= y + GROUND_BAND) nodes++;
    return { y, nodes };
  }, [lattice]);

  const open = useCallback((files: File[]) => {
    setBusy(true);
    setStatus(`reading ${files.length} file${files.length > 1 ? 's' : ''}...`);
    // Let the status paint before parsing blocks the main thread (~1 s
    // for the reference shoe). Import moves into the worker in phase 4.
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
          notes.push(`${it.lattice.name}: ${r.struts.toLocaleString()} struts / ${r.nodes.toLocaleString()} nodes`);
          if (r.dropped.length) notes.push(`dropped ${r.dropped.length} floating piece${r.dropped.length > 1 ? 's' : ''}`);
        } else {
          setIndenter(it.indenter);
          notes.push(`${it.indenter.name}: compressor`);
        }
      }
      notes.push(...errors);
      if (items.length) notes.push(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
      setStatus(notes.join(' · ') || 'ready');
      setBusy(false);
    }, 30);
  }, []);

  const readout = lattice
    ? `${lattice.report.struts.toLocaleString()} struts · ${(lattice.report.nodes * 6).toLocaleString()} dof`
    : '';

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
        />
        <section className="stage">
          <Viewport
            lattice={lattice}
            indenter={indenter}
            gaps={gaps}
            layers={layers}
            hidden={hidden}
            hoverGroup={hoverGroup}
            onDrop={open}
          />
        </section>
        <aside className="panel">
          <nav className="tabs">
            {(['results', 'charts', 'model'] as const).map((t) => (
              <button
                key={t}
                className={t === tab ? 'tab tab--on' : 'tab'}
                // The solver arrives in phases 2 and 4; until then only the
                // model tab has anything true to show.
                disabled={t !== 'model'}
                title={t !== 'model' ? 'solver not built yet' : undefined}
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
          </div>
        </aside>
      </main>
    </div>
  );
}
