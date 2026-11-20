// Controlled-delay race condition & cancellation regression test.
// Run after `npm run build:main`. Uses no network or live accounts.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');
const os = require('node:os');

const ipcHandlers = new Map();
const ipcListeners = new Map();
let mprisInstance = null;

class FakeMprisPlayer extends EventEmitter {
  constructor() {
    super();
    this.playbackStatus = 'Stopped';
    this.metadata = {};
    this.shuffle = false;
    this.loopStatus = 'None';
    this.seekedEvents = [];
    this.getPosition = () => 0;
  }
  objectPath(suffix) {
    return `/org/mpris/MediaPlayer2/${suffix}`;
  }
  seeked(us) {
    this.seekedEvents.push(us);
  }
}

const origLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') {
    return {
      app: { getPath: () => os.tmpdir(), on: () => {} },
      ipcMain: {
        handle: (channel, fn) => ipcHandlers.set(channel, fn),
        on: (channel, fn) => ipcListeners.set(channel, fn),
      },
      BrowserWindow: class {},
      globalShortcut: { register: () => {}, unregisterAll: () => {} },
      Menu: { buildFromTemplate: () => ({}) },
      Tray: class { setToolTip() {} setContextMenu() {} on() {} destroy() {} },
      nativeImage: { createFromPath: () => ({ resize: () => ({}) }), createEmpty: () => ({}) },
      session: {},
    };
  }
  if (name === 'mpris-service') {
    return () => {
      mprisInstance = new FakeMprisPlayer();
      return mprisInstance;
    };
  }
  return origLoad.call(this, name, ...args);
};

const base = path.resolve(__dirname, '../dist/main');
const youtube = require(path.join(base, 'ytmusic'));
const spotify = require(path.join(base, 'spotify'));
const native = require(path.join(base, 'spotifyNative'));
const { getDb } = require(path.join(base, 'db'));
const { resolveUniversalStream } = require(path.join(base, 'providers'));
const { DesktopIntegration } = require(path.join(base, 'desktop'));
const { TitleMatch } = require(path.join(base, 'automix'));

function delayed(ms, signal, valueFactory) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(null);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(typeof valueFactory === 'function' ? valueFactory() : valueFactory);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function testReverseOrderCancellationAndState() {
  const settings = getDb().settings;
  settings.nativeSpotifyEnabled = true;
  settings.preferredAudioSource = 'auto';
  settings.enabledSources = { ...settings.enabledSources, spotify: true, youtube: true };
  spotify.getSpotifyAudioCredentials = async () => ({ token: 'test-token' });

  const abortedIds = [];
  const delaysById = {
    'trackAAAAAA': 320,
    'trackBBBBBB': 160,
    'trackCCCCCC': 25,
    'prebufNEXT1': 260,
  };

  youtube.ytmusicGetStreamUrl = (videoId, signal) => {
    const ms = delaysById[videoId] ?? 50;
    signal?.addEventListener('abort', () => abortedIds.push(videoId), { once: true });
    return delayed(ms, signal, () => `https://example.invalid/stream/${videoId}`);
  };
  youtube.ytmusicSearchSongs = async () => [];
  spotify.spotifySearchCandidates = async () => [];
  native.resolveNativeSpotify = async (_id, _creds, _manual, signal) => {
    return delayed(200, signal, null);
  };

  const trackA = { id: 'trackAAAAAA', title: 'Track A', artist: 'Artist A', duration: 200, source: 'youtube', thumbnail: 'https://img/a.jpg' };
  const trackB = { id: 'trackBBBBBB', title: 'Track B', artist: 'Artist B', duration: 210, source: 'youtube', thumbnail: 'https://img/b.jpg' };
  const trackC = { id: 'trackCCCCCC', title: 'Track C', artist: 'Artist C', duration: 220, source: 'youtube', thumbnail: 'https://img/c.jpg' };
  const trackPrebuf = { id: 'prebufNEXT1', title: 'Prebuf Next', artist: 'Artist N', duration: 190, source: 'youtube', thumbnail: 'https://img/n.jpg' };

  // 1. Prebuffer starts, then user triggers A -> B -> C rapidly
  const pPrebuf = resolveUniversalStream(trackPrebuf, 'youtube', [], { priority: 'prebuffer' });
  const pA = resolveUniversalStream(trackA, 'youtube', [], { priority: 'playback' });
  const pB = resolveUniversalStream(trackB, 'youtube', [], { priority: 'playback' });
  const pC = resolveUniversalStream(trackC, 'youtube', [], { priority: 'playback' });

  const [resPrebuf, resA, resB, resC] = await Promise.all([pPrebuf, pA, pB, pC]);

  assert.equal(resPrebuf.streamUrl, null, 'Prebuffer must be cancelled when playback starts');
  assert.equal(resA.streamUrl, null, 'Superseded track A resolution must be cancelled');
  assert.equal(resB.streamUrl, null, 'Superseded track B resolution must be cancelled');
  assert.equal(resC.streamUrl, 'https://example.invalid/stream/trackCCCCCC', 'Latest track C must resolve');
  assert.ok(abortedIds.includes('prebufNEXT1'), 'Prebuffer underlying stream fetch must receive abort signal');
  assert.ok(abortedIds.includes('trackAAAAAA'), 'Track A underlying stream fetch must receive abort signal');
  assert.ok(abortedIds.includes('trackBBBBBB'), 'Track B underlying stream fetch must receive abort signal');

  // 2. Full state + MPRIS (desktop.ts) race simulation: A -> B -> C with late responses
  const desktop = new DesktopIntegration();
  const sentToRenderer = [];
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (ch, payload) => sentToRenderer.push({ ch, payload }) },
    on: () => {},
    show: () => {},
    focus: () => {},
  };
  desktop.init(fakeWindow);
  desktop.setupIPC();

  const updateLyrics = ipcListeners.get('desktop:updateLyrics');
  const updatePosition = ipcListeners.get('desktop:updatePosition');
  assert.ok(mprisInstance, 'MPRIS player should initialize on Linux');

  // Simulated renderer playback state (mirrors usePlayer.ts generation guards)
  const queue = [trackA, trackB, trackC];
  const state = {
    generation: 0,
    queue,
    queueIndex: 0,
    currentTrack: null,
    audioUrl: null,
    position: 0,
    sourceBadge: '',
    lyricsTrackId: null,
    lyricsText: '',
    isPlaying: false,
  };

  async function launchTrack(index, resolveDelayMs, lyricsDelayMs, coverDelayMs) {
    const track = state.queue[index];
    const gen = ++state.generation;
    state.queueIndex = index;
    state.currentTrack = { ...track };
    state.position = 0;
    state.isPlaying = false;
    state.sourceBadge = 'Ищем аудиопоток…';
    desktop.updatePresence({
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      position: 0,
      isPlaying: false,
      thumbnail: track.thumbnail,
    });

    // Out-of-order async cover lookup
    const coverTask = delayed(coverDelayMs, undefined, `https://cached/${track.id}.jpg`).then((thumb) => {
      if (gen === state.generation && state.currentTrack?.id === track.id) {
        state.currentTrack = { ...state.currentTrack, thumbnail: thumb };
      }
    });

    // Out-of-order async lyrics lookup (intentionally arrives even without renderer guard to test desktop.ts!)
    const lyricsTask = delayed(lyricsDelayMs, undefined, [{ time: 1, text: `Lyrics for ${track.title}` }]).then((lines) => {
      if (gen === state.generation && state.currentTrack?.id === track.id) {
        state.lyricsTrackId = track.id;
        state.lyricsText = lines[0].text;
      }
      // Deliberately send late IPC to desktop.ts even for superseded tracks to prove desktop.ts rejects it!
      updateLyrics({}, track.id, lines);
    });

    // Out-of-order stream resolution
    const streamTask = delayed(resolveDelayMs, undefined, `https://audio/${track.id}`).then((url) => {
      if (gen !== state.generation) return;
      state.audioUrl = url;
      state.sourceBadge = `YOUTUBE • Opus (${track.id})`;
      state.isPlaying = true;
      desktop.updatePresence({
        id: track.id,
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        position: 0,
        isPlaying: true,
        thumbnail: state.currentTrack.thumbnail,
      });
    });

    // Simulate a late position update from a superseded track
    const posTask = delayed(resolveDelayMs + 30, undefined, 42).then((pos) => {
      updatePosition({}, pos, false, track.id);
      if (gen === state.generation && state.currentTrack?.id === track.id) {
        state.position = pos;
      }
    });

    return Promise.all([coverTask, lyricsTask, streamTask, posTask]);
  }

  // Trigger A (slowest), then B (medium), then C (fastest)
  const runA = launchTrack(0, 180, 220, 200);
  const runB = launchTrack(1, 100, 140, 120);
  const runC = launchTrack(2, 20, 35, 10);

  await Promise.all([runA, runB, runC]);

  // Verify ALL 7 elements strictly reflect Track C after A & B late responses arrive
  assert.equal(state.audioUrl, 'https://audio/trackCCCCCC', 'Audio URL must remain Track C');
  assert.equal(state.currentTrack.title, 'Track C', 'Title must remain Track C');
  assert.equal(state.currentTrack.thumbnail, 'https://cached/trackCCCCCC.jpg', 'Cover must remain Track C');
  assert.equal(state.position, 42, 'Position must reflect Track C only');
  assert.equal(state.lyricsTrackId, 'trackCCCCCC', 'Renderer lyrics must remain Track C');
  assert.equal(state.lyricsText, 'Lyrics for Track C', 'Renderer lyrics text must remain Track C');
  assert.equal(state.sourceBadge, 'YOUTUBE • Opus (trackCCCCCC)', 'Source badge must remain Track C');
  assert.equal(state.queueIndex, 2, 'Queue index must remain Track C');

  // Verify MPRIS state strictly reflects Track C (late A & B IPCs rejected by desktop.ts)
  assert.equal(mprisInstance.metadata['xesam:title'], 'Track C', 'MPRIS title must remain Track C');
  assert.equal(mprisInstance.metadata['mpris:artUrl'], 'https://cached/trackCCCCCC.jpg', 'MPRIS artUrl must remain Track C');
  assert.equal(mprisInstance.metadata['xesam:asText'], '[00:01.00]Lyrics for Track C', 'MPRIS lyrics must not be overwritten by late A/B');
  assert.equal(mprisInstance.getPosition(), 42 * 1e6, 'MPRIS position must not be overwritten by late A/B');
  assert.equal(mprisInstance.playbackStatus, 'Playing', 'MPRIS playbackStatus must remain Playing');

  // 3. Test MPRIS Next -> Next -> Previous events propagate cleanly
  mprisInstance.emit('next');
  mprisInstance.emit('next');
  mprisInstance.emit('previous');
  const mediaActions = sentToRenderer.filter((e) => e.ch === 'shortcut:media').map((e) => e.payload);
  assert.deepEqual(mediaActions, ['next', 'next', 'prev'], 'MPRIS Next/Previous events must be forwarded in order');

  // Simulate MPRIS Next -> Next -> Previous starting from index 0: 0 -> 1 -> 2 -> 1 (Track B)
  state.queueIndex = 0;
  const mprisRuns = [];
  for (const action of mediaActions) {
    if (action === 'next') state.queueIndex = (state.queueIndex + 1) % state.queue.length;
    if (action === 'prev') state.queueIndex = (state.queueIndex - 1 + state.queue.length) % state.queue.length;
    const delayMs = action === 'prev' ? 15 : 140;
    mprisRuns.push(launchTrack(state.queueIndex, delayMs, delayMs + 20, delayMs + 10));
  }
  await Promise.all(mprisRuns);
  assert.equal(state.currentTrack.id, 'trackBBBBBB', 'After Next, Next, Previous, Track B must win');
  assert.equal(mprisInstance.metadata['xesam:title'], 'Track B', 'MPRIS title must match Track B after Next/Next/Prev');
  assert.equal(mprisInstance.metadata['xesam:asText'], '[00:01.00]Lyrics for Track B', 'MPRIS lyrics must match Track B');

  desktop.destroy();
}

async function testSpotifyFallbackAndVersionSeparation() {
  const settings = getDb().settings;
  settings.nativeSpotifyEnabled = true;
  settings.preferredAudioSource = 'auto';
  settings.enabledSources = { ...settings.enabledSources, spotify: true, youtube: true };
  spotify.getSpotifyAudioCredentials = async () => ({ token: 'test-token' });

  // Spotify fails -> falls back to YouTube cleanly
  const spTrack = {
    id: 'spotify:2plbrEY59IikOBgBGLjaoe',
    title: 'Die With A Smile',
    artist: 'Lady Gaga, Bruno Mars',
    duration: 252,
    source: 'spotify',
  };
  native.resolveNativeSpotify = async (_id, _creds, _manual, signal) => delayed(60, signal, null);
  youtube.ytmusicSearchSongs = async () => [
    { id: 'kPa7bsKwL-c', title: 'Die With A Smile', artist: 'Lady Gaga, Bruno Mars', duration: 252 },
  ];
  youtube.ytmusicGetStreamUrl = async (id) => `https://example.invalid/yt/${id}`;

  const fallbackRes = await resolveUniversalStream(spTrack, undefined, [], { priority: 'playback' });
  assert.equal(fallbackRes.actualSource, 'youtube', 'Failed Spotify track must fall back to YouTube');
  assert.equal(fallbackRes.streamUrl, 'https://example.invalid/yt/kPa7bsKwL-c');

  // Version separation with identical duration
  const pairs = [
    ['Blinding Lights', 'Blinding Lights (Live)', true],
    ['Blinding Lights', 'Blinding Lights (Remix)', true],
    ['Blinding Lights (DJ Alpha Remix)', 'Blinding Lights (DJ Beta Remix)', true],
    ['Blinding Lights (Acoustic)', 'Blinding Lights', true],
  ];
  for (const [wanted, candidate, expectedMismatch] of pairs) {
    assert.equal(
      TitleMatch.hasVersionMismatch(wanted, candidate),
      expectedMismatch,
      `Version mismatch check failed for "${wanted}" vs "${candidate}"`
    );
    const evalRes = TitleMatch.evaluate({
      wantedTitle: wanted,
      wantedArtists: ['The Weeknd'],
      wantedDurationMs: 200000,
      candidateTitle: candidate,
      candidateArtist: 'The Weeknd',
      candidateDurationMs: 200000,
    });
    assert.equal(evalRes.accepted, false, `Distinct versions must not match even with identical duration: ${wanted} vs ${candidate}`);
  }
}

(async () => {
  await testReverseOrderCancellationAndState();
  await testSpotifyFallbackAndVersionSeparation();
  console.log('Playback races: A->B->C reverse-order cancellation, MPRIS Next/Prev, prebuffer preemption, Spotify fallback, and version separation PASSED');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
