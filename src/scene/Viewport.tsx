/**
 * Three.js stage, phase-1 version: struts as hairlines (one draw call), the
 * compressor as a translucent sheet, and each node's start gap to the
 * compressor as points on the magnitude ramp. Instanced cylinder struts,
 * the view cube and the section plane come with phase 3.
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

interface Props {
  lattice: Lattice | null;
  indenter: Indenter | null;
  gaps: Float64Array | null;
  layers: Layers;
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

export function Viewport({ lattice, indenter, gaps, layers, hidden, hoverGroup, onDrop }: Props) {
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
    const lattice = new THREE.Group(), compressor = new THREE.Group(), gapsG = new THREE.Group(), grid = new THREE.Group();
    scene.add(grid, lattice, compressor, gapsG);
    stage.current = { renderer, scene, camera, controls, lattice, compressor, gaps: gapsG, grid, framed: false };

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
      [lattice, compressor, gapsG, grid].forEach(dispose);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      stage.current = null;
    };
  }, []);

  // Struts, rebuilt when the lattice, hidden groups or hovered group change.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    dispose(s.lattice);
    dispose(s.grid);
    if (!lattice) return;
    const bone = new THREE.Color(css('--mx-bone'));
    const coral = new THREE.Color(css('--accent'));
    const n = lattice.struts.length / 2;
    const pos: number[] = [], col: number[] = [];
    for (let k = 0; k < n; k++) {
      const g = lattice.groups[lattice.strutGroup[k]];
      if (hidden.has(g)) continue;
      const c = g === hoverGroup ? coral : bone;
      for (const end of [lattice.struts[2 * k], lattice.struts[2 * k + 1]]) {
        pos.push(lattice.nodes[3 * end], lattice.nodes[3 * end + 1], lattice.nodes[3 * end + 2]);
        col.push(c.r, c.g, c.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    s.lattice.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false })));
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
  }, [lattice, hidden, hoverGroup]);

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

  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.lattice.visible = layers.lattice;
    s.compressor.visible = layers.compressor;
    s.gaps.visible = layers.gaps;
    s.grid.visible = layers.grid;
  }, [layers, lattice, indenter, gaps]);

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
