/**
 * Force against travel past first contact, one point per solved step,
 * with the slider's state marked. Hand-drawn canvas, like
 * human_data_capture's charts.
 */
import { useEffect, useRef } from 'react';
import type { StepResult } from '../fea/solve';
import type { ResultView } from '../fea/results';

interface Props {
  steps: StepResult[];
  firstContact: number;
  /** Force rescale for a material change (E now / E run). */
  scale: number;
  view: ResultView;
  targets: number[];
}

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** A round tick step (1, 2 or 5 × 10ⁿ) giving about `count` ticks. */
function niceStep(max: number, count = 4): number {
  const raw = max / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

export function ChartsPanel({ steps, firstContact, scale, view, targets }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    const pts = [{ x: 0, y: 0 }, ...steps.map((s) => ({ x: (s.delta - firstContact) * 1e3, y: s.force * scale }))];
    const xs = niceStep(Math.max(...pts.map((p) => p.x)) || 1);
    const ys = niceStep(Math.max(...pts.map((p) => p.y), ...targets) || 1);
    const xMax = Math.ceil((Math.max(...pts.map((p) => p.x)) * 1.02) / xs) * xs || 1;
    const yMax = Math.ceil((Math.max(...pts.map((p) => p.y), ...targets) * 1.02) / ys) * ys || 1;
    const L = 44, R = 12, T = 10, B = 26;
    const X = (x: number) => L + (x / xMax) * (W - L - R);
    const Y = (y: number) => H - B - (y / yMax) * (H - T - B);
    const bone = css('--mx-bone');
    g.font = `10px ${css('--font-mono')}`;
    g.lineWidth = 1;
    // Grid and axis labels.
    g.strokeStyle = css('--mx-bone-08');
    g.fillStyle = css('--mx-bone-55');
    for (let y = 0; y <= yMax + 1e-9; y += ys) {
      g.beginPath(); g.moveTo(L, Y(y)); g.lineTo(W - R, Y(y)); g.stroke();
      g.textAlign = 'right'; g.fillText(`${+y.toFixed(6)}`, L - 6, Y(y) + 3);
    }
    for (let x = 0; x <= xMax + 1e-9; x += xs) {
      g.beginPath(); g.moveTo(X(x), T); g.lineTo(X(x), H - B); g.stroke();
      g.textAlign = 'center'; g.fillText(`${+x.toFixed(3)}`, X(x), H - B + 14);
    }
    g.textAlign = 'left';
    g.fillText('n', 4, T + 8);
    g.textAlign = 'right';
    g.fillText('mm past contact', W - R, H - 2);
    // Force targets as faint hairlines.
    g.strokeStyle = css('--mx-bone-16');
    g.setLineDash([2, 3]);
    for (const t of targets) { g.beginPath(); g.moveTo(L, Y(t)); g.lineTo(W - R, Y(t)); g.stroke(); }
    g.setLineDash([]);
    // The curve and its solved points.
    g.strokeStyle = bone;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
    g.stroke();
    g.fillStyle = bone;
    for (const p of pts) g.fillRect(X(p.x) - 2, Y(p.y) - 2, 4, 4);
    // The slider's state: coral, the indicator.
    g.strokeStyle = css('--accent');
    const vx = X((view.delta - firstContact) * 1e3), vy = Y(view.force);
    g.beginPath(); g.moveTo(vx, H - B); g.lineTo(vx, vy); g.lineTo(L, vy); g.stroke();
  }, [steps, firstContact, scale, view, targets]);

  return (
    <div>
      <figure className="chart">
        <div className="chart__head"><span>compressor force vs travel</span><span className="muted">{steps.length} steps</span></div>
        <div className="chart__plot" style={{ height: 260 }}><canvas ref={ref} style={{ height: 260 }} /></div>
        <p className="chart__note muted">
          squares are solved steps; the slider interpolates between them. the curve stiffens as more of the footbed
          and outsole come into contact. dashed lines are the 0.5 × bw solve targets.
        </p>
      </figure>
    </div>
  );
}
