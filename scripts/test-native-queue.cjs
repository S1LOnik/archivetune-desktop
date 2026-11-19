// Exercise the bridge queue without Spotify credentials or network access.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const Module = require('node:module');
const path = require('node:path');
const childProcess = require('node:child_process');
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return { app: { on() {} }, ipcMain: { handle() {} } };
  return load.call(this, name, ...args);
};
let active = 0, maxActive = 0;
childProcess.spawn = () => {
  const proc = new EventEmitter();
  proc.killed = false;
  proc.stdout = new PassThrough();
  proc.stdin = new Writable({ write(chunk, _enc, done) {
    const request = JSON.parse(chunk.toString());
    active++; maxActive = Math.max(maxActive, active);
    setTimeout(() => {
      active--;
      proc.stdout.write(JSON.stringify({ requestId: request.requestId, ok: true, url: 'http://127.0.0.1/test', qualityLabel: 'test' }) + '\n');
    }, 30);
    done();
  }});
  proc.kill = () => { proc.killed = true; };
  return proc;
};
const { resolveNativeSpotify } = require(path.resolve(__dirname, '../dist/main/spotifyNative'));
(async () => {
  const credentials = { token: 'test' };
  const results = await Promise.all([
    resolveNativeSpotify('spotify:03PBhCMyaun6MYvpwVE0PQ', credentials, true),
    resolveNativeSpotify('spotify:6jqoKhozNa7Jx0mGHUDskO', credentials, true),
  ]);
  assert.ok(results.every(Boolean));
  assert.equal(maxActive, 1, 'bridge must receive only one request at a time');
  const { spotifyTrackId } = require(path.resolve(__dirname, '../dist/main/spotifyNative'));
  const id = '03PBhCMyaun6MYvpwVE0PQ';
  assert.equal(spotifyTrackId(id), id);
  assert.equal(spotifyTrackId('spotify:track:' + id), id);
  assert.equal(spotifyTrackId('spotify://track/' + id), id);
  assert.equal(spotifyTrackId('spotify://' + id), id);
  assert.equal(spotifyTrackId('https://open.spotify.com/intl-de/track/' + id + '?si=test'), id);
  assert.equal(spotifyTrackId('spotify:album:' + id), undefined);
  assert.equal(spotifyTrackId('https://example.invalid/' + id), undefined);
  console.log('Native Spotify queue: two concurrent callers resolved serially');
})().catch(error => { console.error(error); process.exitCode = 1; });
