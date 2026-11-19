const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { copyFile, mkdtemp, rm } = require('node:fs/promises');
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
    for (const [sampleRate, fftSize] of [[22050, 1024], [11025, 512]]) {
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
