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
const pending = new Map<number, { resolve: (value: any) => void; timer: ReturnType<typeof setTimeout> }>();
const candidates = () => [path.join(__dirname,'../../assets/spotify-native'),path.join(process.resourcesPath || '', 'spotify-native')];
function shutdown() {
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
      if(result.ok){connected=true;lastError='';}else{lastError=result.httpStatus ? `Spotify отклонил аудиозапрос (HTTP ${Number(result.httpStatus)})` : 'Не удалось открыть нативное аудио: проверьте соединение и доступ аккаунта';cooldownUntil=Date.now()+60000;}
      request.resolve(result.ok?result:null);
    }catch{/* Ignore non-protocol diagnostic output. */}
  });
  const ended=()=>{if(child===proc){lastError='Аудиодвижок Spotify недоступен: требуется Java 17+';cooldownUntil=Date.now()+60000;shutdown();}};
  proc.on('error',ended);proc.on('exit',ended);
  return proc;
}
export async function resolveNativeSpotify(id: string, credentials: {token: string; user?: string} | null): Promise<{url:string;qualityLabel:string;lossless:false;actualSource:'spotify'} | null> {
  const clean=id.replace(/^spotify:(track:)?/,'');
  if(!/^[a-zA-Z0-9]{22}$/.test(clean)||!credentials||Date.now()<cooldownUntil)return null;
  const proc=start();if(!proc?.stdin)return null;
  const number=++requestId;
  const result=await new Promise<any>(resolve=>{
    const timer=setTimeout(()=>{lastError='Spotify не ответил вовремя; используется резервный источник';cooldownUntil=Date.now()+60000;shutdown();},12000);
    pending.set(number,{resolve,timer});
    proc.stdin!.write(JSON.stringify({requestId:number,uri:`spotify:track:${clean}`,token:credentials.token,user:credentials.user||''})+'\n',error=>{if(error)shutdown();});
  });
  if(!result?.url)return null;
  return {url:result.url,qualityLabel:result.qualityLabel,lossless:false,actualSource:'spotify'};
}
export function setupNativeSpotifyIPC(credentials: () => Promise<{token:string;user?:string}|null>): void {
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
