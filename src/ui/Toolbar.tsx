import { ACCEPT } from '../io/index';
import { Logo } from './Logo';

interface Props {
  readout: string;
  status: string;
  busy: boolean;
  onOpen: (files: File[]) => void;
}

export function Toolbar({ readout, status, busy, onOpen }: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <span className="wordmark"><Logo className="wordmark__logo" />MORPHXGEN</span>
        <span className="toolbar__tool">fea_sim</span>
      </div>

      <div className="toolbar__status">
        {readout && <span className="muted">{readout}</span>}
        <span className={busy ? 'status status--busy' : 'status'}>{status}</span>
      </div>

      <div className="toolbar__actions">
        <label className="btn btn--primary">
          open
          <input
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) onOpen(files);
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </header>
  );
}
