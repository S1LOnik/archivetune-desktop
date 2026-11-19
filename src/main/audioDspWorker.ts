import { parentPort } from 'node:worker_threads';
import { analyzeAutoMixFeatures, runAcousticAuditFft } from './audioDsp';
import type { AudioDspRequest, AudioDspResponse } from './audioDspClient';

const port = parentPort;
if (!port) throw new Error('Audio DSP requires a worker thread');

port.on('message', ({ id, job }: AudioDspRequest) => {
  try {
    const { samples, sampleRate } = job;
    const result = job.kind === 'audit'
      ? runAcousticAuditFft(samples, sampleRate)
      : analyzeAutoMixFeatures(samples, sampleRate, job.fftSize);
    port.postMessage({ id, result } satisfies AudioDspResponse);
  } catch (error) {
    port.postMessage({ id, error: String(error) } satisfies AudioDspResponse);
  }
});
