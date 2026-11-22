const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { copyFile, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { runAudioDsp } = require('../dist/main/audioDspClient');

const dist = path.resolve(__dirname, '../dist/main');
const nativeBinary = path.join(dist, 'audio-dsp.wasm');
const legacyWasmStub = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x0d, 0x03,
  0x60, 0x00, 0x01, 0x7f,
  0x60, 0x01, 0x7f, 0x01, 0x7f,
  0x60, 0x00, 0x00,
  0x03, 0x04, 0x03, 0x01, 0x00, 0x02,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x2c, 0x04,
  0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
  0x07, 0x70, 0x72, 0x65, 0x70, 0x61, 0x72, 0x65, 0x00, 0x00,
  0x09, 0x69, 0x6d, 0x61, 0x67, 0x69, 0x6e, 0x61, 0x72, 0x79, 0x00, 0x01,
  0x09, 0x74, 0x72, 0x61, 0x6e, 0x73, 0x66, 0x6f, 0x72, 0x6d, 0x00, 0x02,
  0x0a, 0x0e, 0x03,
  0x04, 0x00, 0x41, 0x00, 0x0b,
  0x04, 0x00, 0x41, 0x00, 0x0b,
  0x02, 0x00, 0x0b,
]);

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

  const firstFrameLength = fftSize + step;
  const narrowBand = signal(sampleRate, 1, 440).subarray(0, firstFrameLength);
  const shortPtr = prepare_acoustic_samples(firstFrameLength - 1);
  assert.notEqual(shortPtr, 0);
  new Float32Array(memory.buffer, shortPtr, firstFrameLength - 1).set(narrowBand.subarray(1));
  const shortResult = audit_acoustic(sampleRate);
  assert.notEqual(shortResult, 0);
  assert.deepEqual(Array.from(new Float64Array(memory.buffer, shortResult, 5)), [0, 0, sampleRate / 2, 0, 0]);

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

  const boundaryRate = 40960;
  for (const [cutoff, verdict] of [[16190, 0], [16200, 1], [20190, 1], [20200, 2]]) {
    const pcm = Float32Array.from({ length: 6144 }, (_, i) =>
      Math.sin(2 * Math.PI * (cutoff - 10) * i / boundaryRate));
    ptr = prepare_acoustic_samples(pcm.length);
    assert.notEqual(ptr, 0);
    new Float32Array(memory.buffer, ptr, pcm.length).set(pcm);
    result = audit_acoustic(boundaryRate);
    assert.notEqual(result, 0);
    data = new Float64Array(memory.buffer, result, 5);
    assert.equal(data[0], cutoff, `cutoff ${cutoff} Hz`);
    assert.equal(data[4], verdict, `verdict at ${cutoff} Hz`);
  }
});

test('Rust acoustic ABI: highBandEnergyRatio precision and sample rates', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(nativeBinary));
  const { memory, prepare_acoustic_samples, audit_acoustic } = instance.exports;

  for (const sampleRate of [8000, 11025, 22050, 29999, 30000, 32000, 44100, 48000, 192000]) {
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
    if (sampleRate <= 30000 || sampleRate === 32000) assert.equal(data[3], 0);
    assert.equal(data[2], sampleRate / 2, `nyquist at ${sampleRate}Hz`);
  }
});

test('Rust acoustic ABI: validates bounds, memory growth, and invalid inputs', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const { instance } = await WebAssembly.instantiate(await readFile(nativeBinary));
  const { memory, prepare, hann_window, prepare_acoustic_samples, audit_acoustic } = instance.exports;

  assert.equal(audit_acoustic(44100), 0, 'audit before prepare');
  assert.equal(prepare_acoustic_samples(0), 0, 'zero length');
  assert.equal(prepare_acoustic_samples(-1), 0, 'negative length');

  // Verify WASM memory growth detaches previously cached JS TypedArray views while preserving FFT pointers.
  const fftPtr = prepare(512);
  const hannPtr = hann_window();
  assert.notEqual(fftPtr, 0);
  assert.notEqual(hannPtr, 0);
  const cachedHannView = new Float32Array(memory.buffer, hannPtr, 512);
  const initialMemoryBytes = memory.buffer.byteLength;

  const maxLength = 4_194_304;
  const maxPtr = prepare_acoustic_samples(maxLength);
  assert.notEqual(maxPtr, 0, 'accepts 16MiB of PCM');
  assert.ok(memory.buffer.byteLength > initialMemoryBytes, '16MiB PCM allocation grows WASM memory');
  assert.equal(cachedHannView.length, 0, 'cached JS TypedArray view detaches after WASM memory growth');
  assert.ok(maxPtr + maxLength * Float32Array.BYTES_PER_ELEMENT <= memory.buffer.byteLength);
  assert.equal(hann_window(), hannPtr, 'acoustic allocation preserves prepared FFT hann pointer');
  assert.equal(prepare(512), fftPtr, 'acoustic allocation preserves prepared FFT real pointer');
  const refreshedHann = new Float32Array(memory.buffer, hannPtr, 512);
  assert.equal(refreshedHann[0], 0);
  assert.ok(refreshedHann[256] > 0.99);

  assert.equal(prepare_acoustic_samples(maxLength + 1), 0, 'exceeds 16MiB bound');
  assert.equal(audit_acoustic(44100), 0, 'invalid prepare clears the previous input');

  const validPtr = prepare_acoustic_samples(8192);
  assert.notEqual(validPtr, 0, 'valid allocation');
  for (const invalidRate of [0, -0, -1, Infinity, -Infinity, NaN, Number.MIN_VALUE]) {
    assert.equal(audit_acoustic(invalidRate), 0, `invalid sample rate ${invalidRate}`);
  }
  assert.notEqual(audit_acoustic(192000), 0, 'frame count is independent of the sample rate');

  for (const badSample of [NaN, Infinity, -Infinity]) {
    const pcmView = new Float32Array(memory.buffer, validPtr, 8192);
    pcmView.fill(0);
    pcmView[100] = badSample;
    assert.equal(audit_acoustic(44100), 0, `non-finite PCM (${badSample})`);
  }
});

test('Rust acoustic analysis matches pure-JS fallback across waveforms and low sample rates', {
  skip: !existsSync(nativeBinary),
}, async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'archivetune-dsp-parity-'));
  try {
    const fallbackPath = path.join(temporary, 'audioDsp.js');
    await copyFile(path.join(dist, 'audioDsp.js'), fallbackPath);
    const pureJs = require(fallbackPath);
    const integrated = require('../dist/main/audioDsp');
    const { instance } = await WebAssembly.instantiate(await readFile(nativeBinary));
    const { memory, prepare_acoustic_samples, audit_acoustic } = instance.exports;

    function noisySignal(rate, duration, baseFreq) {
      const samples = new Float32Array(rate * duration);
      let seed = 1;
      for (let i = 0; i < samples.length; i++) {
        const t = i / rate;
        const env = Math.exp(-(t % 0.5) * 12);
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const noise = (seed / 2 ** 32 - 0.5) * 0.05;
        samples[i] = 0.4 * env * Math.sin(2 * Math.PI * baseFreq * t) + noise;
      }
      return samples;
    }

    const cases = [
      [44100, signal(44100, 3, 440)],
      [44100, signal(44100, 3, 8000)],
      [44100, noisySignal(44100, 3, 1000)],
      [22050, signal(22050, 3, 3000)],
      [16000, signal(16000, 3, 2000)],
      [30000, signal(30000, 3, 4000)],
      [32000, signal(32000, 3, 5000)],
      [44100, new Float32Array(6143)],
    ];

    const verdictMap = { SUSPECTED_FAKE: 0, UPSCALED_LOSSY: 1, TRUE_LOSSLESS: 2 };
    for (const [sampleRate, samples] of cases) {
      const expected = pureJs.runAcousticAuditFft(samples.slice(), sampleRate);
      const actualIntegrated = integrated.runAcousticAuditFft(samples.slice(), sampleRate);
      const ptr = prepare_acoustic_samples(samples.length);
      assert.notEqual(ptr, 0);
      new Float32Array(memory.buffer, ptr, samples.length).set(samples);
      const result = audit_acoustic(sampleRate);
      assert.notEqual(result, 0);
      const data = new Float64Array(memory.buffer, result, 5);

      assert.equal(data[0], expected.cutoffHz, `cutoffHz match at ${sampleRate}Hz`);
      assert.equal(data[1], expected.rollOffHz, `rollOffHz match at ${sampleRate}Hz`);
      assert.equal(data[2], expected.nyquistHz, `nyquistHz match at ${sampleRate}Hz`);
      assert.ok(Math.abs(data[3] - expected.highBandEnergyRatio) <= 1e-5 * Math.max(1, expected.highBandEnergyRatio));
      assert.equal(data[4], verdictMap[expected.verdict], `verdict match at ${sampleRate}Hz`);
      assert.ok(Math.abs(actualIntegrated.highBandEnergyRatio - expected.highBandEnergyRatio)
        <= 1e-5 * Math.max(1, expected.highBandEnergyRatio));
      assert.deepEqual(
        { ...actualIntegrated, highBandEnergyRatio: expected.highBandEnergyRatio },
        expected,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('TypeScript acoustic fallback handles missing/legacy WASM, oversized arrays, and invalid inputs', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'archivetune-dsp-fallback-'));
  try {
    const missingDir = path.join(temporary, 'missing');
    const legacyDir = path.join(temporary, 'legacy');
    const { mkdir } = require('node:fs/promises');
    await mkdir(missingDir, { recursive: true });
    await mkdir(legacyDir, { recursive: true });

    const missingPath = path.join(missingDir, 'audioDsp.js');
    const legacyPath = path.join(legacyDir, 'audioDsp.js');
    await copyFile(path.join(dist, 'audioDsp.js'), missingPath);
    await copyFile(path.join(dist, 'audioDsp.js'), legacyPath);
    await writeFile(path.join(legacyDir, 'audio-dsp.wasm'), legacyWasmStub);

    const missingWasm = require(missingPath);
    const legacyWasm = require(legacyPath);
    const sampleRate = 44100;
    const samples = signal(sampleRate, 3, 440);

    for (const mod of [missingWasm, legacyWasm]) {
      const result = mod.runAcousticAuditFft(samples, sampleRate);
      assert.ok(result.cutoffHz >= 440 && result.cutoffHz < 800, `fallback cutoffHz: ${result.cutoffHz}`);
      assert.equal(result.sampleRate, sampleRate);
      assert.equal(result.nyquistHz, sampleRate / 2);
      assert.equal(result.verdict, 'SUSPECTED_FAKE');
      assert.ok(Number.isFinite(result.highBandEnergyRatio));

      for (const rate of [8000, 11025, 22050, 29999, 30000]) {
        const lowReport = mod.runAcousticAuditFft(signal(rate, 2, 1000), rate);
        assert.equal(lowReport.highBandEnergyRatio, 0, `low rate ${rate}Hz ratio`);
        assert.ok(Number.isFinite(lowReport.cutoffHz));
      }

      for (const rate of [0, -0, -44100, NaN, Infinity, -Infinity]) {
        const invalidReport = mod.runAcousticAuditFft(samples, rate);
        assert.deepEqual(invalidReport, {
          verdict: 'SUSPECTED_FAKE',
          cutoffHz: 0,
          rollOffHz: 0,
          nyquistHz: 0,
          sampleRate: 0,
          highBandEnergyRatio: 0,
          isTrueLossless: false,
        });
      }
      for (const tinyRate of [Number.MIN_VALUE, 1e-16]) {
        const tinyReport = mod.runAcousticAuditFft(samples, tinyRate);
        assert.equal(tinyReport.verdict, 'SUSPECTED_FAKE');
        assert.equal(tinyReport.highBandEnergyRatio, 0);
        assert.ok(Number.isFinite(tinyReport.cutoffHz) && Number.isFinite(tinyReport.rollOffHz));
      }

      for (const emptyLen of [0, 6143]) {
        assert.deepEqual(mod.runAcousticAuditFft(new Float32Array(emptyLen), sampleRate), {
          verdict: 'SUSPECTED_FAKE',
          cutoffHz: 0,
          rollOffHz: 0,
          nyquistHz: sampleRate / 2,
          sampleRate,
          highBandEnergyRatio: 0,
          isTrueLossless: false,
        });
      }

      for (const bad of [NaN, Infinity, -Infinity]) {
        const badPcm = samples.slice();
        badPcm[123] = bad;
        assert.deepEqual(mod.runAcousticAuditFft(badPcm, sampleRate), {
          verdict: 'SUSPECTED_FAKE',
          cutoffHz: 0,
          rollOffHz: 0,
          nyquistHz: sampleRate / 2,
          sampleRate,
          highBandEnergyRatio: 0,
          isTrueLossless: false,
        });
      }
    }

    const huge = new Float32Array(4_194_305);
    const hugeFallback = missingWasm.runAcousticAuditFft(huge, sampleRate);
    assert.equal(hugeFallback.verdict, 'SUSPECTED_FAKE');
    assert.equal(hugeFallback.cutoffHz, 0);

    if (existsSync(nativeBinary)) {
      const nativeDir = path.join(temporary, 'native-growth');
      await mkdir(nativeDir, { recursive: true });
      await copyFile(path.join(dist, 'audioDsp.js'), path.join(nativeDir, 'audioDsp.js'));
      await copyFile(nativeBinary, path.join(nativeDir, 'audio-dsp.wasm'));
      const freshNative = require(path.join(nativeDir, 'audioDsp.js'));

      const mix1 = freshNative.analyzeAutoMixFeatures(signal(22050, 6, 300), 22050, 1024);
      const hugeNative = freshNative.runAcousticAuditFft(huge, sampleRate);
      assert.equal(hugeNative.verdict, 'SUSPECTED_FAKE');
      assert.equal(hugeNative.cutoffHz, 0);
      const largeAudit = freshNative.runAcousticAuditFft(signal(44100, 3, 440), 44100);
      assert.ok(largeAudit.cutoffHz >= 440);
      const mix2 = freshNative.analyzeAutoMixFeatures(signal(22050, 6, 300), 22050, 1024);
      assert.deepEqual(mix2, mix1);

      const badPcm = samples.slice();
      badPcm[10] = NaN;
      assert.equal(freshNative.runAcousticAuditFft(badPcm, sampleRate).verdict, 'SUSPECTED_FAKE');
      assert.equal(freshNative.runAcousticAuditFft(samples, NaN).verdict, 'SUSPECTED_FAKE');
      assert.equal(freshNative.runAcousticAuditFft(samples, Infinity).verdict, 'SUSPECTED_FAKE');
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
