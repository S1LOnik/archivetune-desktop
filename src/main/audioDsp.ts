/// <reference lib="webworker" />

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AcousticAuditReport, AutoMixAnalysis } from './automix';

type FftExports = {
  memory: WebAssembly.Memory;
  prepare(size: number): number;
  imaginary(): number;
  hann_window?(): number;
  transform(): void;
  prepare_acoustic_samples?(length: number): number;
  audit_acoustic?(sampleRate: number): number;
};

let wasm: FftExports | null | undefined;

function loadWasm(): FftExports | null {
  if (wasm === undefined) {
    try {
      const binary = readFileSync(path.join(__dirname, 'audio-dsp.wasm'));
      wasm = new WebAssembly.Instance(new WebAssembly.Module(binary)).exports as FftExports;
    } catch {
      wasm = null;
    }
  }
  return wasm;
}

function createHannWindow(size: number): Float32Array {
  const hann = new Float32Array(size);
  for (let i = 0; i < size; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  return hann;
}

function createFft(size: number) {
  const instance = loadWasm();
  const realPointer = instance?.prepare(size);
  if (instance && realPointer) {
    const imaginaryPointer = instance.imaginary();
    const hannPointer = instance.hann_window?.();
    return {
      re: new Float32Array(instance.memory.buffer, realPointer, size),
      im: new Float32Array(instance.memory.buffer, imaginaryPointer, size),
      hann: hannPointer
        ? new Float32Array(instance.memory.buffer, hannPointer, size)
        : createHannWindow(size),
      transform: instance.transform,
    };
  }

  const re = new Float32Array(size);
  const im = new Float32Array(size);
  return {
    re,
    im,
    hann: createHannWindow(size),
    transform() {
      im.fill(0);
      fftRadix2(re, im);
    },
  };
}

function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

export type AutoMixFeatures = Omit<AutoMixAnalysis, 'trackId' | 'durationMs' | 'trailingSilenceMs' | 'isUsable'>;

export function analyzeAutoMixFeatures(samples: Float32Array, analysisRate: number, fftSize: number): AutoMixFeatures {
  const hop = fftSize / 2;
  const numBins = fftSize / 2;

  const prevMag = new Float32Array(numBins);
  const { re, im, hann, transform } = createFft(fftSize);
  const flux: number[] = [];
  const energyCurve: number[] = [];
  const vocalCurve: number[] = [];

  const vocalLowBin = Math.max(1, Math.floor((300 * fftSize) / analysisRate));
  const vocalHighBin = Math.min(numBins - 1, Math.floor((3400 * fftSize) / analysisRate));
  const curveStepSamples = Math.max(1, Math.floor(analysisRate * 0.5)); // 500ms step

  let sqSum = 0;
  let curveSamples = 0;
  let bandSum = 0;
  let totalSum = 0;
  let onsetMs = 0;
  let onsetFound = false;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (!onsetFound && Math.abs(s) > 0.015) {
      onsetFound = true;
      onsetMs = Math.round((i * 1000) / analysisRate);
    }
    sqSum += s * s;
    curveSamples++;
    if (curveSamples >= curveStepSamples) {
      energyCurve.push(Math.sqrt(sqSum / curveSamples));
      vocalCurve.push(totalSum > 1e-6 ? bandSum / totalSum : 0);
      sqSum = 0;
      curveSamples = 0;
      bandSum = 0;
      totalSum = 0;
    }
  }

  for (let offset = 0; offset + fftSize <= samples.length; offset += hop) {
    for (let i = 0; i < fftSize; i++) {
      re[i] = samples[offset + i] * hann[i];
    }
    transform();
    let f = 0;
    for (let b = 0; b < numBins; b++) {
      const m = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      const d = m - prevMag[b];
      if (d > 0) f += d;
      prevMag[b] = m;
      totalSum += m;
      if (b >= vocalLowBin && b <= vocalHighBin) bandSum += m;
    }
    flux.push(f);
  }

  // Autocorrelation on Spectral Flux to estimate BPM cleanly in [70..175]
  const fps = analysisRate / hop;
  const minLag = Math.max(4, Math.floor((60 / 175) * fps));
  const maxLag = Math.min(flux.length - 1, Math.ceil((60 / 70) * fps));

  let meanFlux = 0;
  for (const v of flux) meanFlux += v;
  meanFlux /= Math.max(1, flux.length);

  let bestLag = minLag;
  let bestCorr = -Infinity;
  let avgCorr = 0;
  let countLags = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const len = flux.length - lag;
    for (let i = 0; i < len; i++) {
      sum += (flux[i] - meanFlux) * (flux[i + lag] - meanFlux);
    }
    const corr = sum / Math.max(1, len);
    avgCorr += Math.max(0, corr);
    countLags++;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const bpm = Math.round(((60 * fps) / bestLag) * 10) / 10;
  const meanPosCorr = countLags > 0 ? avgCorr / countLags : 1;
  const beatConfidence = Math.min(1.0, Math.max(0.15, bestCorr > 0 && meanPosCorr > 0 ? bestCorr / (meanPosCorr * 3.2) : 0.35));
  const beatIntervalMs = 60000 / Math.max(40, bpm);

  // First downbeat near flux peak in first 2 seconds
  const peakWindow = Math.min(flux.length, Math.ceil(fps * 2));
  let peakIdx = 0;
  for (let i = 1; i < peakWindow; i++) {
    if (flux[i] > flux[peakIdx]) peakIdx = i;
  }
  const firstDownbeatMs = Math.round((peakIdx / fps) * 1000);

  return { bpm, beatConfidence, beatIntervalMs, firstDownbeatMs, onsetMs, energyCurve, vocalCurve };
}

const MAX_ACOUSTIC_SAMPLES = 4_194_304;

const VERDICT_MAP: readonly AcousticAuditReport['verdict'][] = [
  'SUSPECTED_FAKE', // 0
  'UPSCALED_LOSSY', // 1
  'TRUE_LOSSLESS',  // 2
];

function tryAuditAcousticWasm(
  exports: FftExports,
  samples: Float32Array,
  sampleRate: number,
): AcousticAuditReport | null {
  const prepareAcoustic =
    exports.prepare_acoustic_samples ??
    (exports as Record<string, unknown>).prepareAcousticSamples;
  const auditAcoustic =
    exports.audit_acoustic ??
    (exports as Record<string, unknown>).auditAcoustic;

  if (
    typeof prepareAcoustic !== 'function' ||
    typeof auditAcoustic !== 'function'
  ) {
    return null;
  }

  if (samples.length > MAX_ACOUSTIC_SAMPLES || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return null;
  }

  const samplePointer = prepareAcoustic.call(exports, samples.length) as number;
  if (!samplePointer) {
    return null;
  }

  if (samples.length > 0) {
    new Float32Array(exports.memory.buffer, samplePointer, samples.length).set(samples);
  }

  const resultPointer = auditAcoustic.call(exports, sampleRate) as number;
  if (!resultPointer) {
    return null;
  }

  const result = new Float64Array(exports.memory.buffer, resultPointer, 5);
  const cutoffHz = result[0];
  const rollOffHz = result[1];
  const nyquistHz = result[2];
  const highBandEnergyRatio = result[3];
  const verdictId = result[4];

  if (
    !Number.isFinite(cutoffHz) ||
    !Number.isFinite(rollOffHz) ||
    !Number.isFinite(nyquistHz) ||
    !Number.isFinite(highBandEnergyRatio) ||
    !Number.isFinite(verdictId)
  ) {
    return null;
  }

  const verdict = VERDICT_MAP[verdictId];
  if (!verdict) {
    return null;
  }

  return {
    verdict,
    cutoffHz,
    rollOffHz,
    nyquistHz,
    sampleRate,
    highBandEnergyRatio,
    isTrueLossless: verdict === 'TRUE_LOSSLESS',
  };
}

export function runAcousticAuditFft(samples: Float32Array, sampleRate: number): AcousticAuditReport {
  const instance = loadWasm();
  if (instance) {
    try {
      const wasmReport = tryAuditAcousticWasm(instance, samples, sampleRate);
      if (wasmReport) {
        return wasmReport;
      }
    } catch {
      // Conservative fallback on any WASM execution or memory error
    }
  }

  return runAcousticAuditFftFallback(samples, sampleRate);
}

export function runAcousticAuditFftFallback(samples: Float32Array, sampleRate: number): AcousticAuditReport {
  const FFT_SIZE = 4096;
  const step = FFT_SIZE / 2;
  const numFrames = samples.length >= FFT_SIZE ? Math.floor((samples.length - FFT_SIZE) / step) : 0;
  const numBins = FFT_SIZE / 2;
  const safeSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 0;
  const nyquistHz = safeSampleRate / 2;
  const binHz = nyquistHz / numBins;

  const emptyReport: AcousticAuditReport = {
    verdict: 'SUSPECTED_FAKE',
    cutoffHz: 0,
    rollOffHz: 0,
    nyquistHz,
    sampleRate: safeSampleRate,
    highBandEnergyRatio: 0,
    isTrueLossless: false,
  };
  if (safeSampleRate <= 0 || !Number.isFinite(binHz) || binHz <= 0 || numFrames <= 0) {
    return emptyReport;
  }
  for (let i = 0; i < samples.length; i++) {
    if (!Number.isFinite(samples[i])) return emptyReport;
  }

  const sumMag = new Float64Array(numBins);
  const sumEnergy = new Float64Array(numBins);
  const { re, im, hann, transform } = createFft(FFT_SIZE);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * step;
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = samples[offset + i] * hann[i];
    }
    transform();
    for (let b = 0; b < numBins; b++) {
      const m = Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      sumMag[b] += m;
      sumEnergy[b] += m * m;
    }
  }

  let maxMag = 0;
  for (let b = 0; b < numBins; b++) {
    const avg = sumMag[b] / numFrames;
    if (avg > maxMag) maxMag = avg;
  }
  if (maxMag === 0) return emptyReport;
  const maxDb = 20 * Math.log10(Math.max(maxMag, 1e-8));
  const thresholdDb = maxDb - 42;

  let highestActiveBin = -1;
  for (let b = 0; b < numBins; b++) {
    const avgDb = 20 * Math.log10(sumMag[b] / numFrames + 1e-8);
    if (avgDb > thresholdDb) highestActiveBin = b;
  }
  const cutoffHz = highestActiveBin >= 0 ? Math.round(highestActiveBin * binHz) : 0;

  let totalEnergy = 0;
  for (let b = 0; b < numBins; b++) totalEnergy += sumEnergy[b];
  if (!Number.isFinite(totalEnergy)) return emptyReport;
  let accum = 0;
  let rollOffBin = 0;
  for (let b = 0; b < numBins; b++) {
    accum += sumEnergy[b];
    if (accum >= totalEnergy * 0.99) {
      rollOffBin = b;
      break;
    }
  }
  const rollOffHz = Math.round(rollOffBin * binHz);

  const k1k = Math.floor(1000 / binHz);
  const k15k = Math.floor(15000 / binHz);
  const k20_5k = Math.floor(20500 / binHz);
  const k22k = Math.min(numBins - 1, Math.floor(22050 / binHz));

  let midE = 0;
  if (k1k >= 0 && k15k < numBins) {
    for (let b = k1k; b <= k15k; b++) midE += sumEnergy[b];
  }
  let highE = 0;
  if (midE > 0 && k20_5k >= 0 && k20_5k <= k22k) {
    for (let b = k20_5k; b <= k22k; b++) highE += sumEnergy[b];
  }

  const rawRatio = midE > 0 ? highE / midE : 0;
  const ratio = Number.isFinite(rawRatio) ? rawRatio : 0;
  let verdict: AcousticAuditReport['verdict'] = 'UPSCALED_LOSSY';
  if (cutoffHz >= 20200 || (rollOffHz >= 19500 && ratio > 1e-6)) {
    verdict = 'TRUE_LOSSLESS';
  } else if (cutoffHz < 16200) {
    verdict = 'SUSPECTED_FAKE';
  }

  return {
    verdict,
    cutoffHz,
    rollOffHz,
    nyquistHz,
    sampleRate,
    highBandEnergyRatio: ratio,
    isTrueLossless: verdict === 'TRUE_LOSSLESS',
  };
}
