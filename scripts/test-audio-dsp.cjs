const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { copyFile, mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runAudioDsp } = require('../dist/main/audioDspClient');

const dist = path.resolve(__dirname, '../dist/main');
const nativeBinary = path.join(dist, 'audio-dsp.wasm');

function signal(rate, duration, frequency) {
  return Float32Array.from({ length: rate * duration }, (_, index) => {
    const seconds = index / rate;
    const envelope = Math.exp(-(seconds % 0.5) * 12);
    return 0.45 * envelope * Math.sin(2 * Math.PI * frequency * seconds);
  });
}

test('the worker transfers PCM and handles overlapping analysis jobs', async () => {
  const sampleRate = 44100;
  const samples = signal(sampleRate, 3, 440);
  const audit = runAudioDsp({ kind: 'audit', samples, sampleRate });
  assert.equal(samples.byteLength, 0);

  const mix = runAudioDsp({
    kind: 'automix', samples: signal(22050, 6, 300), sampleRate: 22050, fftSize: 1024,
  });
  const silence = runAudioDsp({
    kind: 'audit', samples: new Float32Array(sampleRate), sampleRate,
  });
  const [report, features, silentReport] = await Promise.all([audit, mix, silence]);
  assert.equal(report.verdict, 'SUSPECTED_FAKE');
  assert.ok(report.cutoffHz >= 440 && report.cutoffHz < 800, `cutoff: ${report.cutoffHz}`);
  assert.ok(Math.abs(features.bpm - 120) < 5, `bpm: ${features.bpm}`);
  assert.equal(features.energyCurve.length, 12);
  assert.equal(silentReport.isTrueLossless, false);
  assert.equal(silentReport.cutoffHz, 0);
});

test('Rust exposes the Hann coefficients for each prepared FFT size', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(nativeBinary));
  const { memory, prepare, hann_window: hannWindow } = instance.exports;
  assert.equal(hannWindow(), 0);

  for (const size of [512, 4096, 1024, 512]) {
    assert.notEqual(prepare(size), 0);
    const pointer = hannWindow();
    assert.notEqual(pointer, 0);
    const window = new Float32Array(memory.buffer, pointer, size);
    assert.equal(window[0], 0);
    assert.equal(window[size - 1], 0);
    for (let index = 0; index < size; index++) {
      const expected = Math.fround(0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1))));
      assert.ok(Math.abs(window[index] - expected) <= 1e-7, `FFT size ${size}, coefficient ${index}`);
    }
    prepare(size);
    assert.equal(hannWindow(), pointer);
  }
});

test('Rust and TypeScript agree across FFT sizes and frequency bands', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'archivetune-dsp-'));
  try {
    // Loading the JS module by itself exercises the production fallback.
    const fallbackPath = path.join(temporary, 'audioDsp.js');
    await copyFile(path.join(dist, 'audioDsp.js'), fallbackPath);
    const fallback = require(fallbackPath);
    const native = require('../dist/main/audioDsp');
    for (const [sampleRate, fftSize] of [[22050, 1024], [11025, 256], [11025, 512]]) {
      const pcm = signal(sampleRate, 6, 300);
      assert.deepEqual(native.analyzeAutoMixFeatures(pcm, sampleRate, fftSize),
        fallback.analyzeAutoMixFeatures(pcm, sampleRate, fftSize));
    }

    // Exercise a second resize and both classifications with meaningful cutoffs.
    for (const frequency of [440, 21000, 440]) {
      const pcm = signal(44100, 3, frequency);
      const actual = native.runAcousticAuditFft(pcm, 44100);
      const expected = fallback.runAcousticAuditFft(pcm, 44100);
      assert.ok(Math.abs(actual.highBandEnergyRatio - expected.highBandEnergyRatio)
        <= 1e-5 * Math.max(1, expected.highBandEnergyRatio));
      assert.deepEqual({ ...actual, highBandEnergyRatio: expected.highBandEnergyRatio }, expected);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('Rust acoustic ABI: silence and single frame boundary', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(nativeBinary));
  const { memory, prepare_acoustic_samples, audit_acoustic } = instance.exports;
  if (!prepare_acoustic_samples || !audit_acoustic) return;

  const sampleRate = 44100;
  const fftSize = 4096;
  const step = fftSize / 2;

  const silence = new Float32Array(sampleRate);
  const samplePtr = prepare_acoustic_samples(silence.length);
  assert.notEqual(samplePtr, 0);
  new Float32Array(memory.buffer, samplePtr, silence.length).set(silence);
  const silentResult = audit_acoustic(sampleRate);
  assert.notEqual(silentResult, 0);
  const silentData = new Float64Array(memory.buffer, silentResult, 5);
  assert.equal(silentData[0], 0, 'silent cutoffHz');
  assert.equal(silentData[4], 0, 'silent verdict: SUSPECTED_FAKE');

  const singleFrame = fftSize + step - 1;
  const narrowBand = signal(sampleRate, singleFrame / sampleRate, 440);
  const ptr = prepare_acoustic_samples(narrowBand.length);
  assert.notEqual(ptr, 0);
  new Float32Array(memory.buffer, ptr, narrowBand.length).set(narrowBand);
  const result = audit_acoustic(sampleRate);
  assert.notEqual(result, 0);
  const data = new Float64Array(memory.buffer, result, 5);
  assert.ok(data[0] >= 440 && data[0] < 1000, `single frame cutoffHz: ${data[0]}`);
  assert.equal(data[2], sampleRate / 2, 'nyquistHz');
  assert.equal(data[4], 0, 'single frame narrow-band verdict');
});

test('Rust acoustic ABI: narrow versus wide bandwidth verdicts', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(nativeBinary));
  const { memory, prepare_acoustic_samples, audit_acoustic } = instance.exports;
  if (!prepare_acoustic_samples || !audit_acoustic) return;

  const sampleRate = 48000;
  const narrow = signal(sampleRate, 3, 12000);
  let ptr = prepare_acoustic_samples(narrow.length);
  assert.notEqual(ptr, 0);
  new Float32Array(memory.buffer, ptr, narrow.length).set(narrow);
  let result = audit_acoustic(sampleRate);
  assert.notEqual(result, 0);
  let data = new Float64Array(memory.buffer, result, 5);
  assert.ok(data[0] < 16200, `narrow cutoffHz ${data[0]} < 16200`);
  assert.equal(data[4], 0, 'narrow verdict: SUSPECTED_FAKE');

  const upscaled = signal(sampleRate, 3, 18000);
  ptr = prepare_acoustic_samples(upscaled.length);
  new Float32Array(memory.buffer, ptr, upscaled.length).set(upscaled);
  result = audit_acoustic(sampleRate);
  data = new Float64Array(memory.buffer, result, 5);
  assert.ok(data[0] >= 16200 && data[0] < 20200, `upscaled cutoffHz ${data[0]} in [16200,20200)`);
  assert.equal(data[4], 1, 'upscaled verdict: UPSCALED_LOSSY');

  function wideband(rate, duration) {
    const samples = new Float32Array(rate * duration);
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate;
      const env = Math.exp(-(t % 0.5) * 12);
      samples[i] = 0.2 * env * (Math.sin(2 * Math.PI * 440 * t) + 0.5 * Math.sin(2 * Math.PI * 8000 * t) + 0.3 * Math.sin(2 * Math.PI * 15000 * t) + 0.15 * Math.sin(2 * Math.PI * 21000 * t));
    }
    return samples;
  }

  const wide = wideband(sampleRate, 3);
  ptr = prepare_acoustic_samples(wide.length);
  new Float32Array(memory.buffer, ptr, wide.length).set(wide);
  result = audit_acoustic(sampleRate);
  data = new Float64Array(memory.buffer, result, 5);
  assert.ok(data[0] >= 20200, `wideband cutoffHz ${data[0]} >= 20200`);
  assert.ok(data[3] > 1e-6, `wideband highBandEnergyRatio ${data[3]} > 1e-6`);
  assert.equal(data[4], 2, 'wideband verdict: TRUE_LOSSLESS');
});

test('Rust acoustic ABI: highBandEnergyRatio precision and sample rates', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(nativeBinary));
  const { memory, prepare_acoustic_samples, audit_acoustic } = instance.exports;
  if (!prepare_acoustic_samples || !audit_acoustic) return;

  for (const sampleRate of [22050, 44100, 48000]) {
    const freq = Math.min(10000, sampleRate * 0.4);
    const samples = signal(sampleRate, 3, freq);
    const ptr = prepare_acoustic_samples(samples.length);
    assert.notEqual(ptr, 0);
    new Float32Array(memory.buffer, ptr, samples.length).set(samples);
    const result = audit_acoustic(sampleRate);
    assert.notEqual(result, 0);
    const data = new Float64Array(memory.buffer, result, 5);
    assert.ok(Number.isFinite(data[3]), `finite ratio at ${sampleRate}Hz`);
    assert.ok(data[3] >= 0, `non-negative ratio at ${sampleRate}Hz`);
    assert.equal(data[2], sampleRate / 2, `nyquist at ${sampleRate}Hz`);
  }
});

test('Rust acoustic ABI: validates bounds and returns null on invalid input', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(nativeBinary));
  const { prepare_acoustic_samples, audit_acoustic } = instance.exports;
  if (!prepare_acoustic_samples || !audit_acoustic) return;

  assert.equal(prepare_acoustic_samples(0), 0, 'zero length');
  assert.equal(prepare_acoustic_samples(4194305), 0, 'exceeds 16MiB bound');
  assert.equal(audit_acoustic(0), 0, 'zero sample rate');
  assert.equal(audit_acoustic(-1), 0, 'negative sample rate');
  assert.equal(audit_acoustic(Infinity), 0, 'infinite sample rate');
  assert.equal(audit_acoustic(NaN), 0, 'NaN sample rate');

  const validPtr = prepare_acoustic_samples(8192);
  assert.notEqual(validPtr, 0, 'valid allocation');
  const tooShort = audit_acoustic(192000);
  assert.equal(tooShort, 0, 'insufficient frames at high sample rate');
});

test('Rust acoustic analysis matches TypeScript for diverse waveforms', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(nativeBinary));
  const { memory, prepare_acoustic_samples, audit_acoustic } = instance.exports;
  if (!prepare_acoustic_samples || !audit_acoustic) return;

  const fallback = require('../dist/main/audioDsp');

  function noisySignal(rate, duration, baseFreq) {
    const samples = new Float32Array(rate * duration);
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate;
      const env = Math.exp(-(t % 0.5) * 12);
      const noise = (Math.random() - 0.5) * 0.05;
      samples[i] = 0.4 * env * Math.sin(2 * Math.PI * baseFreq * t) + noise;
    }
    return samples;
  }

  const sampleRate = 44100;
  const testCases = [
    signal(sampleRate, 3, 440),
    signal(sampleRate, 3, 8000),
    noisySignal(sampleRate, 3, 1000),
  ];

  for (const samples of testCases) {
    const expected = fallback.runAcousticAuditFft(samples.slice(), sampleRate);
    const ptr = prepare_acoustic_samples(samples.length);
    new Float32Array(memory.buffer, ptr, samples.length).set(samples);
    const result = audit_acoustic(sampleRate);
    const data = new Float64Array(memory.buffer, result, 5);

    assert.equal(data[0], expected.cutoffHz, 'cutoffHz match');
    assert.equal(data[1], expected.rollOffHz, 'rollOffHz match');
    assert.equal(data[2], expected.nyquistHz, 'nyquistHz match');
    assert.ok(Math.abs(data[3] - expected.highBandEnergyRatio) <= 1e-5 * Math.max(1, expected.highBandEnergyRatio), 'highBandEnergyRatio precision');
    const verdictMap = { SUSPECTED_FAKE: 0, UPSCALED_LOSSY: 1, TRUE_LOSSLESS: 2 };
    assert.equal(data[4], verdictMap[expected.verdict], 'verdict match');
  }
});

test('TypeScript acoustic fallback when WASM missing or exports absent', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'archivetune-dsp-'));
  try {
    const fallbackPath = path.join(temporary, 'audioDsp.js');
    await copyFile(path.join(dist, 'audioDsp.js'), fallbackPath);
    const fallback = require(fallbackPath);

    const sampleRate = 44100;
    const samples = signal(sampleRate, 3, 440);
    const result = fallback.runAcousticAuditFft(samples, sampleRate);

    assert.ok(result.cutoffHz >= 440 && result.cutoffHz < 800, `fallback cutoffHz: ${result.cutoffHz}`);
    assert.equal(result.sampleRate, sampleRate);
    assert.equal(result.nyquistHz, sampleRate / 2);
    assert.equal(result.verdict, 'SUSPECTED_FAKE');
    assert.ok(Number.isFinite(result.highBandEnergyRatio));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
