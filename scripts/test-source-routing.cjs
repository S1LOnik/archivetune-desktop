// Run after npm run build:main. No network or real account is used.
const assert = require('assert/strict');
const Module = require('module');
const path = require('path');
const os = require('os');
const load = Module._load;
Module._load = function (name, ...args) {
  if (name === 'electron') return {
    app: { getPath: () => os.tmpdir(), on: () => {} },
    ipcMain: { handle: () => {} }, BrowserWindow: class {}, session: {},
  };
  return load.call(this, name, ...args);
};
const base = path.resolve(__dirname, '../dist/main');
const youtube = require(path.join(base, 'ytmusic'));
let candidates = [];
const requested = [];
youtube.ytmusicSearchSongs = async () => candidates;
youtube.ytmusicGetStreamUrl = async (id) => { requested.push(id); return 'https://example.invalid/audio'; };
const { getDb } = require(path.join(base, 'db'));
const spotify = require(path.join(base, 'spotify'));
const native = require(path.join(base, 'spotifyNative'));
const { resolveUniversalStream } = require(path.join(base, 'providers'));
const youtubeAuth = require(path.join(base, 'youtubeAuth'));
const { TitleMatch } = require(path.join(base, 'automix'));
const track = { id: 'spotify:5WETPr3XdOG4DPEq1mIzsg', title: 'Ветер меняет направление', artist: 'Moya Mishel', duration: 167, source: 'spotify' };
const candidate = (duration, title = track.title) => ({ id: 'candidate01', title, artist: track.artist, duration });
(async () => {
  for (const wrong of [candidate(122), candidate(0), candidate(167, track.title + ' remix'), candidate(167, track.title + ' (Radio Edit)')]) {
    candidates = [wrong];
    const result = await resolveUniversalStream(track, 'youtube');
    assert.equal(result.streamUrl, null, 'Wrong or unverifiable recordings must be rejected');
  }
  assert.equal(requested.length, 0, 'Rejected recordings must not be opened');
  candidates = [candidate(167)];
  const exact = await resolveUniversalStream(track, 'youtube');
  assert.equal(exact.actualSource, 'youtube');
  assert.equal(requested[0], 'candidate01');
  const vera = { id: 'spotify:03PBhCMyaun6MYvpwVE0PQ', title: 'Реальная жизнь', artist: 'Vera Brezhneva', duration: 233, source: 'spotify' };
  candidates = [{ id: '9O4M7BWbXZQ', title: 'Реальная жизнь', artist: 'Вера Брежнева', duration: 233 }];
  const cyrillic = await resolveUniversalStream(vera, 'youtube');
  assert.equal(cyrillic.actualSource, 'youtube');
  assert.ok(cyrillic.streamUrl, 'Equivalent Cyrillic artist should match Latin Spotify name');

  // Test full URL / URI shapes
  const veraWebUrl = { id: 'https://open.spotify.com/track/03PBhCMyaun6MYvpwVE0PQ', title: 'Реальная жизнь', artist: 'Vera Brezhneva', duration: 233, source: 'spotify' };
  const webResolved = await resolveUniversalStream(veraWebUrl, 'youtube');
  assert.equal(webResolved.actualSource, 'youtube');
  assert.ok(webResolved.streamUrl, 'Spotify web URL identifier shape must resolve');

  // Test Ukrainian Cyrillic characters (є, і, ї)
  const elzy = { id: 'spotify:50nLp5q3kX7F5n6u8W1g4F', title: 'Обійми', artist: 'Okean Elzy', duration: 224, source: 'spotify' };
  candidates = [{ id: 'elzy-yt', title: 'Обійми', artist: 'Океан Ельзи', duration: 224 }];
  const ukrainian = await resolveUniversalStream(elzy, 'youtube');
  assert.equal(ukrainian.actualSource, 'youtube');
  assert.ok(ukrainian.streamUrl, 'Ukrainian Cyrillic artist must match Latin spelling');

  candidates = [{ id: 'wrong-artist', title: 'Реальная жизнь', artist: 'Другой исполнитель', duration: 233 }];
  const otherArtist = await resolveUniversalStream(vera, 'youtube');
  assert.equal(otherArtist.streamUrl, null, 'Different artists must still be rejected');
  candidates = [candidate(40)];
  const truncated = await resolveUniversalStream({ ...track, duration: 55 }, 'youtube');
  assert.equal(truncated.streamUrl, null, 'A 15-second difference is too large for a 55-second track');
  candidates = [];
  const wrongProviderId = await resolveUniversalStream({ ...track, id: 'abcdefghijk' }, 'youtube');
  assert.equal(wrongProviderId.streamUrl, null, 'An 11-character ID from Spotify is not a YouTube video ID');
  const directYoutube = await resolveUniversalStream({ ...track, id: 'abcdefghijk', source: 'youtube' }, 'youtube');
  assert.ok(directYoutube.streamUrl, 'The same ID is valid when it comes from YouTube');
  const settings = getDb().settings;
  settings.nativeSpotifyEnabled = true;
  settings.preferredAudioSource = 'auto';
  spotify.getSpotifyAudioCredentials = async () => ({ token: 'test' });
  const nativeIds = [];
  native.resolveNativeSpotify = async (id) => {
    nativeIds.push(id);
    return { url: 'http://127.0.0.1/native', qualityLabel: 'Spotify native Vorbis', actualSource: 'spotify' };
  };
  const linked = { ...track, id: 'abcdefghijk', source: 'youtube', spotifyUri: track.id };
  assert.equal((await resolveUniversalStream(linked)).actualSource, 'spotify');
  assert.equal(nativeIds.at(-1), '5WETPr3XdOG4DPEq1mIzsg');
  assert.equal((await resolveUniversalStream({...track, source: 'youtube'})).actualSource, 'spotify');

  const unlinked = { ...linked, spotifyUri: undefined };
  let catalog = [];
  spotify.spotifySearchCandidates = async () => catalog;
  assert.equal((await resolveUniversalStream(unlinked)).actualSource, 'youtube',
    'A YouTube recording without a Spotify match keeps its original stream');

  const acceptedSpotify = { ...track, album: linked.album };
  for (const wrong of [
    { ...acceptedSpotify, title: track.title + ' (Radio Edit)' },
    { ...acceptedSpotify, duration: 152 },
    { ...acceptedSpotify, artist: 'Другой исполнитель' },
    { ...acceptedSpotify, artist: '' },
  ]) {
    catalog = [wrong];
    const previousCalls = nativeIds.length;
    assert.equal((await resolveUniversalStream(unlinked)).actualSource, 'youtube');
    assert.equal(nativeIds.length, previousCalls, 'Auto mode must not open a different recording');
  }
  catalog = [acceptedSpotify];
  const autoSpotify = await resolveUniversalStream(unlinked);
  assert.equal(autoSpotify.actualSource, 'spotify',
    'Auto mode must prefer a verified Spotify match even after a previous YouTube fallback');
  assert.equal(autoSpotify.spotifyId, '5WETPr3XdOG4DPEq1mIzsg');

  const takeOnMe = { id: 'HzdD8kbDzZA', title: 'Take on Me', artist: 'Композиция • a-ha', duration: 0, source: 'youtube' };
  let nextCalls = 0;
  youtubeAuth.innerTubePost = async (endpoint, payload) => {
    assert.equal(endpoint, 'next');
    assert.equal(payload.videoId, takeOnMe.id);
    ++nextCalls;
    return { contents: { playlistPanelRenderer: { contents: [
      { playlistPanelVideoRenderer: { videoId: 'other-track', lengthText: { simpleText: '1:00' } } },
      { playlistPanelVideoRenderer: { videoId: takeOnMe.id, lengthText: { runs: [{ text: '3:45' }] } } },
    ] } } };
  };
  catalog = [{ ...takeOnMe, id: track.id, artist: 'a-ha', duration: 225, source: 'spotify' }];
  let searchedQuery;
  spotify.spotifySearchCandidates = async (query) => {
    searchedQuery = query;
    return catalog;
  };
  assert.equal((await resolveUniversalStream(takeOnMe)).actualSource, 'spotify',
    'A legacy YouTube card can use the exact video duration and cleaned artist for Spotify matching');
  assert.equal(searchedQuery, 'Take on Me a-ha');
  assert.equal(await youtube.ytmusicGetTrackDuration(takeOnMe.id), 225);
  assert.equal(nextCalls, 1, 'The duration is read from the exact ID and reused');
  for (const title of ['Take on Me (DJ One Remix)', 'Take on Me (2017 Acoustic)', 'Take on Me (Live)', 'Take on Me (Speed Up)']) {
    assert.equal((await resolveUniversalStream({ ...takeOnMe, title })).actualSource, 'youtube',
      'The original recording must not replace a distinct version');
  }
  assert.equal(TitleMatch.hasVersionMismatch('Take on Me (DJ One Remix)', 'Take on Me - DJ Two Remix'), true);
  assert.equal(TitleMatch.hasVersionMismatch('Take on Me (DJ One Remix) [Official Audio]', 'Take on Me - DJ One Remix'), false);
  assert.equal(TitleMatch.hasVersionMismatch('Take on Me (Sped Up)', 'Take on Me - Speed Up'), false);
  assert.equal(TitleMatch.hasVersionMismatch('Take on Me (Ремикс)', 'Take on Me'), true);
  assert.equal(TitleMatch.hasVersionMismatch('Take on Me (Radio Edit)', 'Take on Me (Extended Mix)'), true);
  assert.equal(TitleMatch.evaluate({
    wantedTitle: 'Take on Me (Remix)', candidateTitle: 'Take on Me (Remix)',
    wantedArtists: ['a-ha, DJ One'], candidateArtist: 'a-ha, DJ Two',
    wantedDurationMs: 225000, candidateDurationMs: 225000,
  }).accepted, false, 'Generic remix labels with different remixer credits must not match');

  const ships = { id: 'GKI76SCJI2I', title: 'Корабли', artist: "Глюк'oZa", duration: 227, source: 'youtube' };
  catalog = [{
    ...ships, id: 'spotify:3wa1dhDOa16EoHb9xJbQZ2', source: 'spotify', duration: 226, album: 'Москва',
  }];
  const autoShips = await resolveUniversalStream(ships);
  assert.equal(autoShips.actualSource, 'spotify');
  assert.equal(autoShips.spotifyId, '3wa1dhDOa16EoHb9xJbQZ2');
  catalog = [acceptedSpotify];
  settings.preferredAudioSource = 'youtube';
  assert.equal((await resolveUniversalStream(unlinked)).actualSource, 'youtube',
    'Explicit YouTube preference must override the automatic Spotify match');
  settings.preferredAudioSource = 'auto';
  settings.enabledSources = { ...settings.enabledSources, spotify: false };
  assert.equal((await resolveUniversalStream(unlinked)).actualSource, 'youtube',
    'Auto mode must respect disabled Spotify');
  settings.enabledSources.spotify = true;
  catalog = [];
  getDb().likedSongs.push(track);
  assert.equal((await resolveUniversalStream(unlinked)).actualSource, 'spotify',
    'An exact recording already in the Spotify library is preferred without another catalog search');
  getDb().likedSongs.pop();
  settings.preferredAudioSource = 'spotify';
  catalog = [acceptedSpotify];
  const matchedSpotify = await resolveUniversalStream(unlinked);
  assert.equal(matchedSpotify.actualSource, 'spotify',
    'Changing the preferred provider must supersede a cached YouTube result');
  assert.equal(matchedSpotify.spotifyId, '5WETPr3XdOG4DPEq1mIzsg',
    'Lyrics must receive the resolved Spotify ID for an unlinked YouTube queue item');
  const forcedYoutube = await resolveUniversalStream(linked, 'youtube');
  assert.equal(forcedYoutube.actualSource, 'youtube',
    'An explicit per-track provider must override Spotify preference');
  assert.equal(forcedYoutube.spotifyId, undefined);

  candidates = [candidate(167)];
  const fallbackReady = new Promise(resolve => { youtube.ytmusicSearchSongs = async () => {
    resolve();
    return candidates;
  }; });
  let finishNative;
  native.resolveNativeSpotify = () => new Promise(resolve => { finishNative = resolve; });
  let decided = false;
  const primed = resolveUniversalStream(track).then(result => { decided = true; return result; });
  await fallbackReady;
  assert.equal(decided, false, 'A faster YouTube fallback must wait for Spotify');
  finishNative({ url: 'http://127.0.0.1/native', qualityLabel: 'Spotify native Vorbis', actualSource: 'spotify' });
  assert.equal((await primed).actualSource, 'spotify');
  const failed = resolveUniversalStream(track);
  await new Promise(resolve => setImmediate(resolve));
  finishNative(null);
  assert.equal((await failed).actualSource, 'youtube');

  console.log('Source routing: wrong duration, unknown duration, different version and invalid artist rejected; matching Latin/Cyrillic recordings accepted');
})().catch(error => { console.error(error); process.exitCode = 1; });
