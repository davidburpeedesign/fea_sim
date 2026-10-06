/**
 * Main-thread handle on the solver worker. One run at a time: starting a
 * new run (or cancelling) terminates the worker, since a factorization
 * can't be interrupted from outside.
 */
import type { StepResult, SweepInput, SweepResult } from './solve';
import type { FromWorker } from './worker';

export interface RunCallbacks {
  progress: (msg: string) => void;
  step: (s: StepResult, firstContact: number) => void;
}

export class SolverClient {
  private worker: Worker | null = null;
  private id = 0;

  run(input: SweepInput, cb: RunCallbacks): Promise<SweepResult> {
    this.cancel();
    const id = ++this.id;
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.id !== id) return;
        if (m.type === 'progress') cb.progress(m.msg);
        else if (m.type === 'step') cb.step(m.step, m.firstContact);
        else if (m.type === 'done') { this.finish(worker); resolve(m.result); }
        else { this.finish(worker); reject(new Error(m.message)); }
      };
      worker.onerror = (e) => { this.finish(worker); reject(new Error(e.message || 'solver crashed')); };
      worker.postMessage({ type: 'run', id, input });
    });
  }

  cancel() {
    this.worker?.terminate();
    this.worker = null;
  }

  private finish(w: Worker) {
    w.terminate();
    if (this.worker === w) this.worker = null;
  }
}
