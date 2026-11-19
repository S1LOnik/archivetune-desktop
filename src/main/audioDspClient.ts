import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { AcousticAuditReport } from './automix';
import type { AutoMixFeatures } from './audioDsp';

type AudioInput = { samples: Float32Array<ArrayBuffer>; sampleRate: number };
export type AudioDspJob =
  | (AudioInput & { kind: 'audit' })
  | (AudioInput & { kind: 'automix'; fftSize: number });

type Result = { audit: AcousticAuditReport; automix: AutoMixFeatures };
export type AudioDspRequest = { id: number; job: AudioDspJob };
export type AudioDspResponse = { id: number; result: Result[keyof Result] } | { id: number; error: string };

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, (reply: AudioDspResponse) => void>();

function getWorker(): Worker {
  if (worker) return worker;

  const thread = new Worker(path.join(__dirname, 'audioDspWorker.js'));
  worker = thread;

  const fail = (error: Error) => {
    if (worker !== thread) return;
    worker = undefined;
    for (const [id, respond] of pending) respond({ id, error: error.message });
    pending.clear();
  };

  thread.on('error', fail);
  thread.on('exit', code => fail(new Error(`Audio DSP worker exited with code ${code}`)));
  thread.on('message', (reply: AudioDspResponse) => {
    const respond = pending.get(reply.id);
    pending.delete(reply.id);
    respond?.(reply);
    if (!pending.size) thread.unref();
  });

  return thread;
}

export function runAudioDsp<Job extends AudioDspJob>(job: Job): Promise<Result[Job['kind']]> {
  return new Promise((resolve, reject) => {
    const thread = getWorker();
    const id = ++nextId;
    pending.set(id, reply => {
      if ('error' in reply) reject(new Error(reply.error));
      else resolve(reply.result as Result[Job['kind']]);
    });

    try {
      thread.ref();
      // The decoder provides a dedicated buffer. Transfer it without copying.
      thread.postMessage({ id, job } satisfies AudioDspRequest, [job.samples.buffer]);
    } catch (error) {
      pending.delete(id);
      if (!pending.size) thread.unref();
      reject(error);
    }
  });
}
