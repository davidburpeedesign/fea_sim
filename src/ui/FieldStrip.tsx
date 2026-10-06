/**
 * Under the stage: which result colours the struts, the deformation
 * magnification, the colour legend with its numeric scale (colours aren't
 * comparable between solves without it), and the state readout.
 */
import { magnitude, rampCss, rgbCss } from '../core/colormap';

export type Field = 'displacement' | 'strain' | 'axial';
export const FIELDS: { id: Field; label: string }[] = [
  { id: 'displacement', label: 'displacement' },
  { id: 'strain', label: 'fibre strain' },
  { id: 'axial', label: 'axial force' },
];
export const SCALES = [1, 2, 5, 10];

export interface Legend {
  kind: 'magnitude' | 'diverging';
  lo: string;
  hi: string;
  /** Label for the colour beyond the top of the scale, if any. */
  over?: string;
}

interface Props {
  field: Field;
  onField: (f: Field) => void;
  scale: number;
  onScale: (s: number) => void;
  legend: Legend;
  readout: string;
}

const warmHalf = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => rgbCss(magnitude(t))).join(', ')})`;

export function FieldStrip({ field, onField, scale, onScale, legend, readout }: Props) {
  return (
    <div className="fieldstrip">
      <span className="fieldstrip__group">
        <span>field</span>
        <span className="seg">
          {FIELDS.map((f) => (
            <button key={f.id} className={f.id === field ? 'btn btn--on' : 'btn'} onClick={() => onField(f.id)}>{f.label}</button>
          ))}
        </span>
      </span>
      <span className="fieldstrip__group">
        <span>deform ×</span>
        <span className="seg">
          {SCALES.map((s) => (
            <button key={s} className={s === scale ? 'btn btn--on' : 'btn'} onClick={() => onScale(s)}>{s}</button>
          ))}
        </span>
      </span>
      <span className="fieldstrip__group legend">
        <span className="legend__end">{legend.lo}</span>
        <b style={{ background: legend.kind === 'diverging' ? rampCss() : warmHalf }} />
        <span className="legend__end">{legend.hi}</span>
        {legend.over && <><i className="legend__over" /><span className="legend__end">{legend.over}</span></>}
      </span>
      <span className="fieldstrip__readout">{readout}</span>
    </div>
  );
}
