/**
 * Solver worker: the UI's only way into src/fea/ (CLAUDE.md). Steps are
 * posted as they are solved, so the stage can show the first result
 * while the rest of the run continues.
 */
import { runSweep, type StepResult, type SweepInput, type SweepResult } from './solve';

export type ToWorker = { type: 'run'; id: number; input: SweepInput };
export type FromWorker =
  | { type: 'progress'; id: number; msg: string }
  | { type: 'step'; id: number; step: StepResult; firstContact: number }
  | { type: 'done'; id: number; result: SweepResult }
  | { type: 'error'; id: number; message: string };

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const { id, input } = e.data;
  try {
    const result = runSweep(input, {}, {
      progress: (msg) => post({ type: 'progress', id, msg }),
      step: (step, firstContact) => post({ type: 'step', id, step, firstContact }),
    });
    post({ type: 'done', id, result });
  } catch (err) {
    post({ type: 'error', id, message: (err as Error).message });
  }
};
