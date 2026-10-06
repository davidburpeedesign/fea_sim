/**
 * Three.js stage: struts as hairlines (one draw call), deformed and
 * coloured by the selected result field once solved, over a faint
 * undeformed ghost; the compressor as a translucent sheet at its travel;
 * contact nodes; and, before solving, each node's start gap. Instanced
 * cylinder struts, the view cube and the section plane come with phase 3.
 *
 * Visual rules (MORPHXGEN): near-black void, bone hairlines, coral only as
 * the indicator (the hovered group), ramp colours only on data marks.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Indenter, Lattice } from '../core/types';
import { magnitude, rgbCss } from '../core/colormap';
import type { Layers } from '../ui/Sidebar';

export interface Deform {
  /** Displacements, 6 per node, m. */
  u: Float64Array;
  /** Display magnification. */
  scale: number;
  /** Compressor travel past first contact, m. */
  travel: number;
  firstContact: number;
  /** Contact state per node (compressor or floor), > 0 in contact. */
  contacts: Uint8Array;
}

interface Props {
  lattice: Lattice | null;
  indenter: Indenter | null;
  gaps: Float64Array | null;
  deform: Deform | null;
  /** Per strut, two vertices × rgb; null draws bone. */
  colors: Float32Array | null;
  layers: Layers;
  /** Hide struts lying entirely above this height (m); null shows all. */
  clipY: number | null;
  hidden: Set<string>;
  hoverGroup: string | null;
  onDrop: (files: File[]) => void;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#e4e3df';

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  lattice: THREE.Group;
  ghost: THREE.Group;
  contacts: THREE.Group;
  compressor: THREE.Group;
  gaps: THREE.Group;
  grid: THREE.Group;
  framed: boolean;
}

function dispose(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  g.clear();
}

/** Floor grid at the lattice's lowest point: 10 mm cells, 50 mm majors. */
function buildGrid(lat: Lattice): THREE.Group {
  const g = new THREE.Group();
  const bone = new THREE.Color(css('--mx-bone'));
  const { min, max } = lat.bounds;
  const y = min[1];
  const pad = 0.03;
  const x0 = Math.floor((min[0] - pad) / 0.05) * 0.05, x1 = Math.ceil((max[0] + pad) / 0.05) * 0.05;
  const z0 = Math.floor((min[2] - pad) / 0.05) * 0.05, z1 = Math.ceil((max[2] + pad) / 0.05) * 0.05;
  const build = (step: number, opacity: number) => {
    const pts: number[] = [];
    for (let x = x0; x <= x1 + 1e-9; x += step) pts.push(x, y, z0, x, y, z1);
    for (let z = z0; z <= z1 + 1e-9; z += step) pts.push(x0, y, z, x1, y, z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: bone, transparent: true, opacity, depthWrite: false }));
  };
  g.add(build(0.01, 0.05));
  g.add(build(0.05, 0.12));
  return g;
}

export function Viewport({ lattice, indenter, gaps, deform, colors, layers, clipY, hidden, hoverGroup, onDrop }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [drag, setDrag] = useState(false);
  const [gapScale, setGapScale] = useState<[number, number] | null>(null);

  // One renderer for the component's lifetime.
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(new THREE.Color(css('--bg-deep')));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 10);
    camera.position.set(0.5, 0.3, 0.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const lattice = new THREE.Group(), ghost = new THREE.Group(), contacts = new THREE.Group();
    const compressor = new THREE.Group(), gapsG = new THREE.Group(), grid = new THREE.Group();
    scene.add(grid, ghost, lattice, contacts, compressor, gapsG);
    stage.current = { renderer, scene, camera, controls, lattice, ghost, contacts, compressor, gaps: gapsG, grid, framed: false };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      [lattice, ghost, contacts, compressor, gapsG, grid].forEach(dispose);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      stage.current = null;
    };
  }, []);

  // Struts, rebuilt when the lattice, the result shown, hidden groups or
  // the hovered group change. ~60k vertices: cheap enough to rebuild on
  // every slider move.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    dispose(s.lattice);
    dispose(s.ghost);
    dispose(s.contacts);
    dispose(s.grid);
    if (!lattice) return;
    const bone = new THREE.Color(css('--mx-bone'));
    const coral = new THREE.Color(css('--accent'));
    const n = lattice.struts.length / 2;
    const P = lattice.nodes;
    const at = (node: number, k: number) => P[3 * node + k] + (deform ? deform.u[6 * node + k] * deform.scale : 0);
    const pos: number[] = [], col: number[] = [], ghost: number[] = [];
    for (let e = 0; e < n; e++) {
      const g = lattice.groups[lattice.strutGroup[e]];
      if (hidden.has(g)) continue;
      if (clipY !== null && Math.min(P[3 * lattice.struts[2 * e] + 1], P[3 * lattice.struts[2 * e + 1] + 1]) > clipY) continue;
      for (let v = 0; v < 2; v++) {
        const node = lattice.struts[2 * e + v];
        pos.push(at(node, 0), at(node, 1), at(node, 2));
        if (deform) ghost.push(P[3 * node], P[3 * node + 1], P[3 * node + 2]);
        if (g === hoverGroup) col.push(coral.r, coral.g, coral.b);
        else if (colors) col.push(colors[6 * e + 3 * v], colors[6 * e + 3 * v + 1], colors[6 * e + 3 * v + 2]);
        else col.push(bone.r, bone.g, bone.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // Coloured results draw opaque so the ramp reads true; bare geometry
    // stays a translucent hairline.
    s.lattice.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: !colors, opacity: colors ? 1 : 0.5, depthWrite: !!colors,
    })));
    if (deform) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.Float32BufferAttribute(ghost, 3));
      s.ghost.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: bone, transparent: true, opacity: 0.08, depthWrite: false })));
      const cp: number[] = [];
      deform.contacts.forEach((c, node) => { if (c && (clipY === null || P[3 * node + 1] <= clipY)) cp.push(at(node, 0), at(node, 1), at(node, 2)); });
      const cg = new THREE.BufferGeometry();
      cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      s.contacts.add(new THREE.Points(cg, new THREE.PointsMaterial({ color: new THREE.Color(css('--mx-white')), size: 2, sizeAttenuation: false })));
    }
    s.grid.add(buildGrid(lattice));

    // Frame once, on the first lattice; later loads keep the user's view.
    if (!s.framed) {
      const { min, max } = lattice.bounds;
      const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
      s.controls.target.copy(c);
      s.camera.position.copy(c).add(new THREE.Vector3(1.1, 0.55, 0.7).normalize().multiplyScalar(size * 2.1));
      s.camera.near = size / 100;
      s.camera.far = size * 20;
      s.camera.updateProjectionMatrix();
      s.framed = true;
    }
  }, [lattice, hidden, hoverGroup, deform, colors, clipY]);

  // Compressor: translucent sheet plus faint wireframe.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    dispose(s.compressor);
    if (!indenter) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(indenter.positions), 3));
    geo.setIndex(Array.from(indenter.triangles));
    const bone = new THREE.Color(css('--mx-bone'));
    s.compressor.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: bone, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false })));
    s.compressor.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: bone, transparent: true, opacity: 0.12, depthWrite: false })));
  }, [indenter]);

  // Start gaps: closest nodes brightest, the far end of the ramp at 3 mm
  // past first contact, which covers the whole footbed.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    dispose(s.gaps);
    setGapScale(null);
    if (!lattice || !gaps) return;
    let gmin = Infinity;
    for (const g of gaps) if (g < gmin) gmin = g;
    if (!Number.isFinite(gmin)) return;
    const span = 3e-3;
    const pos: number[] = [], col: number[] = [];
    gaps.forEach((g, i) => {
      if (!(g <= gmin + span)) return;
      const c = magnitude(1 - (g - gmin) / span);
      pos.push(lattice.nodes[3 * i], lattice.nodes[3 * i + 1], lattice.nodes[3 * i + 2]);
      col.push(...c);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    s.gaps.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, vertexColors: true })));
    setGapScale([gmin, gmin + span]);
  }, [lattice, gaps]);

  // The compressor sits at its travel: first contact plus the travel past
  // it, magnified like the lattice so it meets the deformed footbed.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.compressor.position.y = deform ? -(deform.firstContact + deform.travel * deform.scale) : 0;
    // Fainter over results, so it doesn't veil the coloured footbed.
    s.compressor.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.opacity = (o instanceof THREE.Mesh ? 0.08 : 0.12) * (deform ? 0.4 : 1);
    });
  }, [deform, indenter]);

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.ghost.visible = layers.undeformed;
    s.contacts.visible = layers.contacts;
    s.lattice.visible = layers.lattice;
    s.compressor.visible = layers.compressor;
    s.gaps.visible = layers.gaps;
    s.grid.visible = layers.grid;
  }, [layers, lattice, indenter, gaps, deform, colors]);

  return (
    <div
      className={drag ? 'viewport viewport--drag' : 'viewport'}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onDrop(files);
      }}
    >
      <div className="viewport__gl" ref={host} />
      {!lattice && !indenter && (
        <div className="viewport__empty">
          <div>
            drop the lattice (.obj polylines) and the compressor (.obj faces) here
            <br />
            <span className="muted">or use open. y up, millimetres.</span>
          </div>
        </div>
      )}
      {layers.gaps && gapScale && (
        <div className="viewport__hud">
          <span className="legend">
            gap to compressor
            <b style={{ background: `linear-gradient(90deg, ${rgbCss(magnitude(1))}, ${rgbCss(magnitude(0))})` }} />
            {(gapScale[0] * 1e3).toFixed(2)}–{(gapScale[1] * 1e3).toFixed(2)} mm
          </span>
        </div>
      )}
      <span className="tick tick--tl" /><span className="tick tick--tr" />
      <span className="tick tick--bl" /><span className="tick tick--br" />
    </div>
  );
}
