import { app, ipcMain } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { getDb, updateSettings } from './db';

let child: ChildProcess | null = null;
let requestId = 0;
let cooldownUntil = 0;
let lastError = '';
let connected = false;
let bridgeRevision = 0;
type SpotifyCredentials = { token: string; user?: string };
type BridgeResponse = { ok: boolean; code?: string; httpStatus?: number; url?: string; qualityLabel?: string };
// The Java bridge reads and resolves one request at a time. Queue requests here
// so a waiting request cannot time out and kill another active playback request.
let nativeQueue: Promise<void> = Promise.resolve();
const pending = new Map<number, { resolve: (value: BridgeResponse | null) => void; timer: ReturnType<typeof setTimeout> }>();
const candidates = () => [path.join(__dirname,'../../assets/spotify-native'),path.join(process.resourcesPath || '', 'spotify-native')];
function shutdown() {
  ++bridgeRevision;
  const current = child; child = null; connected = false;
  current?.kill();
  for (const request of pending.values()) { clearTimeout(request.timer); request.resolve(null); }
  pending.clear();
}
function start(): ChildProcess | null {
  if(child && !child.killed) return child;
  const dir = candidates().find(p => fs.existsSync(path.join(p,'archivetune-spotify.jar')));
  if(!dir) { lastError='Аудиодвижок Spotify не собран'; return null; }
  const proc=spawn('java',['-Dorg.slf4j.simpleLogger.defaultLogLevel=off','-cp',path.join(dir,'*'),'ArchiveTuneSpotify'],{stdio:['pipe','pipe','ignore']});
  child=proc;
  proc.stdin?.on('error',()=>{if(child===proc)shutdown();});
  readline.createInterface({input:proc.stdout!}).on('line',line=>{
    try {
      const result=JSON.parse(line);const request=pending.get(result.requestId);
      if(!request)return;
      pending.delete(result.requestId);clearTimeout(request.timer);
      if(result.ok){connected=true;lastError='';}else{const code = typeof result.code === 'string' && /^[A-Za-z][A-Za-z0-9]{0,80}$/.test(result.code) ? ` (${result.code})` : '';lastError=result.httpStatus ? `Spotify отклонил аудиозапрос (HTTP ${Number(result.httpStatus)})` : `Не удалось открыть нативное аудио${code}: проверьте соединение и доступ аккаунта`;if ([401, 429].includes(Number(result.httpStatus))) cooldownUntil = Date.now() + 10000;}
      request.resolve(result);
    }catch{/* Ignore non-protocol diagnostic output. */}
  });
  const ended=()=>{if(child===proc){lastError='Аудиодвижок Spotify недоступен: требуется Java 17+';cooldownUntil=Date.now()+10000;shutdown();}};
  proc.on('error',ended);proc.on('exit',ended);
  return proc;
}
export function isNativeSpotifyConnected(): boolean {
  return connected;
}

export function spotifyTrackId(value?: string): string | undefined {
  return value?.trim().match(
    /^(?:spotify:(?:track:|\/\/(?:track\/)?)?|https:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/)?([A-Za-z0-9]{22})(?:[?#][^\s]*)?$/,
  )?.[1];
}

function requestNative(
  payload: { uri: string; reload: boolean } | { warmup: true },
  credentials: SpotifyCredentials,
  options: { manual?: boolean; signal?: AbortSignal } = {},
): Promise<BridgeResponse | null> {
  if (options.signal?.aborted) return Promise.resolve(null);
  const revision = bridgeRevision;
  const execute = async () => {
    if (revision !== bridgeRevision || options.signal?.aborted) return null;
    if (!options.manual && Date.now() < cooldownUntil) return null;
    const proc = start();
    if (!proc?.stdin) return null;
    const number = ++requestId;
    return new Promise<BridgeResponse | null>((resolve) => {
      let settled = false;
      const done = (value: BridgeResponse | null) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const onAbort = () => {
        const entry = pending.get(number);
        if (entry) {
          clearTimeout(entry.timer);
          pending.delete(number);
        }
        done(null);
      };
      if (options.signal?.aborted) {
        done(null);
        return;
      }
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        lastError = 'Spotify не ответил вовремя';
        cooldownUntil = Date.now() + 10000;
        shutdown();
      }, 12000);
      pending.set(number, { resolve: done, timer });
      proc.stdin!.write(JSON.stringify({ ...payload, requestId: number, token: credentials.token, user: credentials.user || '' }) + '\n', (error) => {
        if (error && child === proc) shutdown();
      });
    });
  };
  const queued = nativeQueue.then(execute, execute);
  nativeQueue = queued.then(() => {}, () => {});
  if (!options.signal) return queued;
  return new Promise<BridgeResponse | null>((resolve) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };
    if (options.signal!.aborted) {
      onAbort();
      return;
    }
    options.signal!.addEventListener('abort', onAbort, { once: true });
    queued.then(
      (res) => {
        if (settled) return;
        settled = true;
        options.signal!.removeEventListener('abort', onAbort);
        resolve(res);
      },
      () => {
        if (settled) return;
        settled = true;
        options.signal!.removeEventListener('abort', onAbort);
        resolve(null);
      }
    );
  });
}

export async function resolveNativeSpotify(
  id: string,
  credentials: SpotifyCredentials | null,
  manual = false,
  signal?: AbortSignal,
): Promise<{ url: string; qualityLabel: string; lossless: false; actualSource: 'spotify' } | null> {
  const clean = spotifyTrackId(id);
  if (!clean || !credentials) return null;
  const payload = { uri: `spotify:track:${clean}`, reload: manual };
  const options = { manual, signal };
  const revision = bridgeRevision;
  let result = await requestNative(payload, credentials, options);
  if (revision === bridgeRevision && result?.code === 'IOException' && !result.httpStatus && !signal?.aborted) {
    result = await requestNative(payload, credentials, options);
  }
  if (!result?.ok || !result.url) return null;
  return { url: result.url, qualityLabel: result.qualityLabel || 'Spotify native Vorbis', lossless: false, actualSource: 'spotify' };
}

export function setupNativeSpotifyIPC(credentials: () => Promise<SpotifyCredentials | null>): void {
  if (getDb().settings.nativeSpotifyEnabled && getDb().settings.enabledSources.spotify !== false) {
    const revision = bridgeRevision;
    start();
    void credentials().then(async auth => {
      if (!auth || revision !== bridgeRevision || !getDb().settings.nativeSpotifyEnabled) return;
      const response = await requestNative({ warmup: true }, auth);
      if (revision === bridgeRevision && response?.code === 'IOException' && !response.httpStatus) {
        await requestNative({ warmup: true }, auth);
      }
    }).catch(() => {});
  }
  ipcMain.handle('spotify:nativeStatus',()=>({enabled:getDb().settings.nativeSpotifyEnabled ?? false,connected,lastError,bundled:candidates().some(p=>fs.existsSync(path.join(p,'archivetune-spotify.jar')))}));
  ipcMain.handle('spotify:nativeConnect', async () => {
    cooldownUntil = 0;
    shutdown();
    const track = getDb().likedSongs.find((t) => /^spotify:(track:)?[A-Za-z0-9]{22}$/.test(t.id));
    const auth = await credentials();
    if (!auth) return { ok: false, error: 'Сначала войдите в Spotify через OAuth или sp_dc' };
    const testId = track?.id || 'spotify:track:3XvMSVOIQOJ56fObAhs8eY';
    const result = await resolveNativeSpotify(testId, auth);
    if (result) {
      updateSettings({ nativeSpotifyEnabled: true });
      connected = true;
      lastError = '';
      return { ok: true };
    }
    return { ok: false, error: lastError || 'Spotify не предоставил нативный аудиопоток' };
  });
  ipcMain.handle('spotify:nativeDisable',()=>{updateSettings({nativeSpotifyEnabled:false});shutdown();return {ok:true};});
  app.on('before-quit',shutdown);
}
