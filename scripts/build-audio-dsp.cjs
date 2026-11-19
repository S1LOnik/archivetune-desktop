const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');

const target = 'wasm32-unknown-unknown';
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'main', 'audio-dsp.wasm');
const libdir = spawnSync('rustc', ['--print', 'target-libdir', '--target', target], { encoding: 'utf8' });
if (libdir.error?.code === 'ENOENT' || (libdir.status === 0 && !existsSync(libdir.stdout.trim()))) {
  rmSync(output, { force: true });
  console.log('[audio-dsp] Rust WASM toolchain missing. Using the TypeScript worker.');
} else {
  if (libdir.error || libdir.status !== 0) throw libdir.error ?? new Error(libdir.stderr);
  mkdirSync(path.dirname(output), { recursive: true });
  const build = spawnSync('rustc', [
    '--edition=2024', '--target', target, '--crate-type', 'cdylib',
    '-C', 'opt-level=3', '-C', 'strip=symbols',
    path.join(root, 'native', 'audio-dsp', 'lib.rs'), '-o', output,
  ], { stdio: 'inherit' });
  if (build.error || build.status !== 0) throw build.error ?? new Error('Rust audio DSP build failed');
}
