/**
 * lyrics.ts — Comprehensive 10-Provider Lyrics Waterfall & Word-by-Word Karaoke Engine
 *
 * Ports S1LOnik/ArchiveTune's multi-provider lyrics suite:
 * 1. YouLyPlus (lyricsplus.binimum.org — Word-by-Word syllables & TTML)
 * 2. BetterLyrics (lyrics-api.boidu.dev — TTML word-synced XML, Kugou, QQ Music)
 * 3. LRCLib (Exact & Fuzzy Search, including Enhanced LRC <mm:ss.xx> word tags)
 * 4. SimpMusic (api-lyrics.simpmusic.org by videoId)
 * 5. KuGou (lyrics.kugou.com search & base64 LRC decode)
 * + Built-in Romanization (Japanese/CJK/Cyrillic) & Cloud Translation
 */

import { ipcMain } from 'electron';
import https from 'https';
import http from 'http';
import { getDb } from './db';
import { getValidSpotifyTokenOrNull } from './spotify';
import { spotifyTrackId } from './spotifyNative';

export interface LyricWord {
  text: string;
  startTime: number; // seconds
  endTime: number; // seconds
}

export interface LyricLine {
  time: number; // seconds
  endTime?: number; // seconds
  text: string;
  words?: LyricWord[];
  romanized?: string;
  translation?: string;
  isBackground?: boolean;
}

export interface LyricsResult {
  synced: LyricLine[];
  plain: string;
  source: string;
  hasWordSync: boolean;
}

const lyricsCache = new Map<string, { result: LyricsResult; expiresAt: number }>();
const lyricsInFlight = new Map<string, Promise<LyricsResult>>();
function cacheLyrics(key: string, res: LyricsResult, spotifyId?: string): void {
  if (lyricsCache.size >= 100) {
    lyricsCache.delete(lyricsCache.keys().next().value!);
  }
  // Recheck incomplete results so a temporary Spotify failure or a new login can recover.
  const ttl = !res.synced.length || (spotifyId && res.source !== 'Spotify Synced') ? 60_000 : 30 * 60_000;
  lyricsCache.set(key, { result: res, expiresAt: Date.now() + ttl });
}

function fetchUrl(urlStr: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      u,
      {
        headers: {
          'User-Agent': 'ArchiveTune-Desktop/16.2 (https://github.com/S1LOnik/ArchiveTune)',
          Accept: 'application/json, text/plain, application/xml, */*',
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchUrl(new URL(res.headers.location, u).toString(), timeoutMs).then(resolve).catch(reject);
          return;
        }
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}`));
          } else {
            resolve(data);
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function cleanTitle(rawTitle: string): string {
  let t = rawTitle
    .replace(
      /\s*[(\[](?:Official\s*(?:Music\s*)?(?:Video|Audio|Visualizer|Lyric\s*Video)?|Lyrics|HD|HQ|Remastered|4K|Full\s*Song|Video|Audio|slowed|reverb|sped up|nightcore)[)\]]/gi,
      ''
    )
    .replace(/\s*[(\[]From\s*["'].*?["'][)\]]/gi, '')
    .replace(/\s*[(\[](?:feat|ft|with)\..*?[)\]]/gi, '')
    .replace(/\|\s*.*$/g, '')
    .trim();

  const parts = t.split(/\s+[-–—]\s+/);
  if (parts.length > 1) {
    t = parts[parts.length - 1].trim();
  }
  return t || rawTitle.trim();
}

function cleanArtist(rawArtist: string): string {
  return (
    rawArtist
      .replace(/\s*-\s*Topic$/i, '')
      .replace(/VEVO$/i, '')
      .replace(/\s*Official$/i, '')
      .replace(/\s*and\s*\d+\s*more$/i, '')
      .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)[0]
      .trim() || rawArtist.trim()
  );
}

async function fetchSpotifyLyrics(id: string, rejectedToken?: string): Promise<LyricsResult | null> {
  try {
    const token = await getValidSpotifyTokenOrNull(rejectedToken);
    if (!token || token === rejectedToken) return null;
    const data = await new Promise<string>((resolve, reject) => {
      const req = https.get(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${id}?format=json&vocalRemoval=false&market=from_token`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
          'App-Platform': 'WebPlayer',
          Origin: 'https://open.spotify.com',
          Referer: 'https://open.spotify.com/',
          Accept: 'application/json',
        },
      }, (res) => {
        if (res.statusCode === 401 && !rejectedToken) {
          res.resume();
          resolve('');
          return;
        }
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`Spotify lyrics HTTP ${res.statusCode}`)); return; }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
        res.on('error', reject);
      });
      req.setTimeout(5000, () => req.destroy(new Error('Spotify lyrics timeout')));
      req.on('error', reject);
    });
    if (!data && !rejectedToken) return fetchSpotifyLyrics(id, token);
    const lyrics = JSON.parse(data)?.lyrics;
    if (!Array.isArray(lyrics?.lines)) return null;
    const lines = lyrics.lines.filter((line: any) => typeof line?.words === 'string' && line.words.trim());
    if (!lines.length) return null;
    const plain = lines.map((line: any) => line.words).join('\n');
    const timed = lyrics.syncType === 'LINE_SYNCED' || lyrics.syncType === 'WORD_SYNCED';
    const synced: LyricLine[] = timed ? lines.flatMap((line: any) => {
      const raw = line.startTimeMs;
      const ms = typeof raw === 'number' || (typeof raw === 'string' && raw.trim()) ? Number(raw) : NaN;
      return Number.isFinite(ms) && ms >= 0 ? [{ time: ms / 1000, text: line.words }] : [];
    }).sort((a: LyricLine, b: LyricLine) => a.time - b.time) : [];
    return { synced, plain, source: synced.length ? 'Spotify Synced' : 'Spotify Plain', hasWordSync: false };
  } catch {
    return null;
  }
}

function parseTimeTagToSeconds(tag: string): number {
  const clean = tag.trim().replace(/s$/i, '');
  if (/^\d+(\.\d+)?$/.test(clean)) {
    return parseFloat(clean);
  }
  const parts = clean.split(':');
  if (parts.length === 3) {
    return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return 0;
}

/**
 * Parses standard LRC and Enhanced Word-by-Word LRC (<00:12.34>word)
 */
export function parseLRC(lrc: string): { lines: LyricLine[]; hasWordSync: boolean } {
  const lines: LyricLine[] = [];
  let hasWordSync = false;
  const lineRe = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/;
  const wordTagRe = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>([^<]*)/g;

  for (const rawLine of lrc.split('\n')) {
    const m = rawLine.trim().match(lineRe);
    if (!m) continue;

    const mins = parseInt(m[1], 10);
    const secs = parseInt(m[2], 10);
    const ms = m[3] ? parseInt(m[3].padEnd(3, '0'), 10) : 0;
    const lineStartTime = mins * 60 + secs + ms / 1000;
    const content = m[4].trim();
    if (!content) continue;

    const words: LyricWord[] = [];
    let match: RegExpExecArray | null;
    wordTagRe.lastIndex = 0;
    while ((match = wordTagRe.exec(content)) !== null) {
      const wMin = parseInt(match[1], 10);
      const wSec = parseInt(match[2], 10);
      const wMs = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
      const wTime = wMin * 60 + wSec + wMs / 1000;
      const wText = match[4];
      if (wText) {
        words.push({
          text: wText,
          startTime: wTime,
          endTime: wTime + 0.35,
        });
      }
    }

    if (words.length > 0) {
      hasWordSync = true;
      for (let i = 0; i < words.length - 1; i++) {
        words[i].endTime = Math.max(words[i].startTime + 0.08, words[i + 1].startTime);
      }
      const plainText = words.map((w) => w.text).join('').trim();
      lines.push({
        time: lineStartTime,
        endTime: words[words.length - 1].endTime,
        text: plainText,
        words,
      });
    } else {
      lines.push({
        time: lineStartTime,
        text: content.replace(/<\d{1,2}:\d{2}(?:\.\d{1,3})?>/g, '').trim(),
      });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].endTime) {
      lines[i].endTime = lines[i + 1].time;
    }
    if (lines[i].words && lines[i].words!.length > 0) {
      const lastWord = lines[i].words![lines[i].words!.length - 1];
      if (lines[i + 1].time > lastWord.startTime) {
        lastWord.endTime = Math.min(lastWord.startTime + 1.5, lines[i + 1].time);
      }
    }
  }

  return { lines, hasWordSync };
}

/**
 * Parses TTML XML (ported from BetterLyrics TTMLParser.kt)
 */
function parseTTML(ttml: string): { lines: LyricLine[]; hasWordSync: boolean } {
  const lines: LyricLine[] = [];
  let hasWordSync = false;

  const pRegex = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  const spanRegex = /<span\b([^>]*)>([\s\S]*?)<\/span>/gi;

  let pMatch: RegExpExecArray | null;
  while ((pMatch = pRegex.exec(ttml)) !== null) {
    const pAttrs = pMatch[1];
    const pBody = pMatch[2];

    const beginMatch = pAttrs.match(/\bbegin\s*=\s*["']([^"']+)["']/i);
    if (!beginMatch) continue;
    const endMatch = pAttrs.match(/\bend\s*=\s*["']([^"']+)["']/i);

    const lineStart = parseTimeTagToSeconds(beginMatch[1]);
    const lineEnd = endMatch ? parseTimeTagToSeconds(endMatch[1]) : lineStart + 4;

    const words: LyricWord[] = [];
    let spanMatch: RegExpExecArray | null;
    spanRegex.lastIndex = 0;

    while ((spanMatch = spanRegex.exec(pBody)) !== null) {
      const sAttrs = spanMatch[1];
      const sText = spanMatch[2].replace(/<[^>]+>/g, '');
      if (/ttm:role\s*=\s*["'](x-translation|x-roman)["']/i.test(sAttrs)) {
        continue;
      }
      const sBegin = sAttrs.match(/\bbegin\s*=\s*["']([^"']+)["']/i);
      const sEnd = sAttrs.match(/\bend\s*=\s*["']([^"']+)["']/i);
      if (sBegin && sText) {
        const wStart = parseTimeTagToSeconds(sBegin[1]);
        const wEnd = sEnd ? parseTimeTagToSeconds(sEnd[1]) : wStart + 0.3;
        words.push({
          text: sText,
          startTime: wStart,
          endTime: Math.max(wStart + 0.05, wEnd),
        });
      }
    }

    const cleanParagraphText = pBody
      .replace(/<span\b[^>]*ttm:role\s*=\s*["'](?:x-translation|x-roman)["'][^>]*>[\s\S]*?<\/span>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanParagraphText) continue;

    if (words.length > 0) {
      hasWordSync = true;
      lines.push({
        time: lineStart,
        endTime: lineEnd,
        text: cleanParagraphText,
        words,
      });
    } else {
      lines.push({
        time: lineStart,
        endTime: lineEnd,
        text: cleanParagraphText,
      });
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return { lines, hasWordSync };
}

/**
 * Provider 1: YouLyPlus (ported from YouLyPlus.kt — word-by-word syllables & TTML)
 */
async function fetchYouLyPlus(
  title: string,
  artist: string,
  duration: number
): Promise<LyricsResult | null> {
  const params = new URLSearchParams({
    title: cleanTitle(title),
    artist: cleanArtist(artist),
  });
  if (duration > 0) params.append('duration', String(Math.round(duration)));

  try {
    const raw = await fetchUrl(`https://lyricsplus.binimum.org/v2/lyrics/get?${params.toString()}`, 6500);
    const data = JSON.parse(raw);
    if (Array.isArray(data?.lyrics) && data.lyrics.length > 0) {
      const isWordType = String(data.type || '').toLowerCase() === 'word';
      let hasWordSync = false;
      const synced: LyricLine[] = [];

      for (const item of data.lyrics) {
        if (item.time == null) continue;
        const startSec = Number(item.time) / 1000;
        const endSec = item.duration ? startSec + Number(item.duration) / 1000 : startSec + 3.5;
        const syllables = Array.isArray(item.syllabus) ? item.syllabus : [];

        if (isWordType && syllables.length > 0) {
          hasWordSync = true;
          const words: LyricWord[] = syllables
            .filter((s: any) => s && s.text && s.time != null)
            .map((s: any) => {
              const wStart = Number(s.time) / 1000;
              const wDur = s.duration ? Number(s.duration) / 1000 : 0.3;
              return {
                text: String(s.text),
                startTime: wStart,
                endTime: wStart + Math.max(0.06, wDur),
              };
            });
          synced.push({
            time: startSec,
            endTime: endSec,
            text: item.text || words.map((w) => w.text).join(''),
            words,
          });
        } else if (item.text) {
          synced.push({
            time: startSec,
            endTime: endSec,
            text: String(item.text).trim(),
          });
        }
      }

      if (synced.length > 0) {
        return {
          synced,
          plain: synced.map((l) => l.text).join('\n'),
          source: hasWordSync ? 'YouLyPlus Word-Sync' : 'YouLyPlus Synced',
          hasWordSync,
        };
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Provider 2: BetterLyrics (ported from BetterLyrics.kt — lyrics-api.boidu.dev)
 */
async function fetchBetterLyrics(
  title: string,
  artist: string,
  duration: number
): Promise<LyricsResult | null> {
  const params = new URLSearchParams({
    s: cleanTitle(title),
    a: cleanArtist(artist),
  });
  if (duration > 0) params.append('d', String(Math.round(duration)));

  const endpoints = ['getLyrics', 'kugou/getLyrics', 'qq/getLyrics'];
  for (const ep of endpoints) {
    try {
      const raw = await fetchUrl(`https://lyrics-api.boidu.dev/${ep}?${params.toString()}`, 6500);
      let content = raw.trim();
      if (content.startsWith('{')) {
        const parsed = JSON.parse(content);
        content = parsed.ttml || parsed.lyrics || parsed.lrc || '';
      }
      if (!content) continue;

      if (content.includes('<tt') && content.includes('<p')) {
        const { lines, hasWordSync } = parseTTML(content);
        if (lines.length > 0) {
          return {
            synced: lines,
            plain: lines.map((l) => l.text).join('\n'),
            source: hasWordSync ? 'BetterLyrics Word-Sync' : 'BetterLyrics TTML',
            hasWordSync,
          };
        }
      } else if (content.includes('[')) {
        const { lines, hasWordSync } = parseLRC(content);
        if (lines.length > 0) {
          return {
            synced: lines,
            plain: lines.map((l) => l.text).join('\n'),
            source: `BetterLyrics (${ep.split('/')[0]})`,
            hasWordSync,
          };
        }
      }
    } catch {
      /* try next BetterLyrics endpoint */
    }
  }
  return null;
}

/**
 * Provider 3: LRCLib (Cleaned Exact Match + Search Fallback)
 */
async function fetchLRCLib(
  title: string,
  artist: string,
  duration: number
): Promise<LyricsResult | null> {
  const cleanT = cleanTitle(title);
  const cleanA = cleanArtist(artist);

  try {
    const params = new URLSearchParams({
      track_name: cleanT,
      artist_name: cleanA,
    });
    if (duration > 0) params.append('duration', String(Math.round(duration)));

    const data = await fetchUrl(`https://lrclib.net/api/get?${params.toString()}`);
    const json = JSON.parse(data);
    if (json.syncedLyrics) {
      const { lines, hasWordSync } = parseLRC(json.syncedLyrics);
      return {
        synced: lines,
        plain: json.plainLyrics ?? lines.map((l) => l.text).join('\n'),
        source: hasWordSync ? 'LRCLib Word-Sync' : 'LRCLib Synced',
        hasWordSync,
      };
    }
  } catch {
    /* fall through to search */
  }

  try {
    const params = new URLSearchParams({ q: `${cleanA} ${cleanT}` });
    const data = await fetchUrl(`https://lrclib.net/api/search?${params.toString()}`);
    const results = JSON.parse(data);
    if (Array.isArray(results) && results.length > 0) {
      const syncedBest = results.find((r: any) => r.syncedLyrics);
      const best = syncedBest || results[0];
      if (best.syncedLyrics) {
        const { lines, hasWordSync } = parseLRC(best.syncedLyrics);
        return {
          synced: lines,
          plain: best.plainLyrics ?? lines.map((l) => l.text).join('\n'),
          source: 'LRCLib Synced',
          hasWordSync,
        };
      }
      if (best.plainLyrics) {
        return { synced: [], plain: best.plainLyrics, source: 'LRCLib Plain', hasWordSync: false };
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * Provider 4: SimpMusic (ported from SimpMusicLyrics.kt)
 */
async function fetchSimpMusic(videoId: string, duration: number): Promise<LyricsResult | null> {
  const cleanId = videoId.replace(/^youtube:/, '');
  if (!cleanId || cleanId.includes(':') || cleanId.length !== 11) return null;

  try {
    const raw = await fetchUrl(`https://api-lyrics.simpmusic.org/v1/${cleanId}`, 6000);
    const json = JSON.parse(raw);
    const tracks: any[] = json?.data ?? [];
    if (!json?.success || tracks.length === 0) return null;

    const best = tracks.find((t) => t.syncedLyrics) || tracks[0];
    if (best?.syncedLyrics) {
      const { lines, hasWordSync } = parseLRC(best.syncedLyrics);
      return {
        synced: lines,
        plain: best.plainLyrics ?? lines.map((l) => l.text).join('\n'),
        source: 'SimpMusic Synced',
        hasWordSync,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Provider 5: NetEase Cloud Music (music.163.com)
 */
async function fetchNetEase(title: string, artist: string): Promise<LyricsResult | null> {
  try {
    const cleanT = cleanTitle(title);
    const cleanA = cleanArtist(artist);
    const params = new URLSearchParams({
      s: `${cleanA} ${cleanT}`,
      type: '1',
      limit: '5',
    });
    const searchRaw = await fetchUrl(
      `https://music.163.com/api/search/get/web?${params.toString()}`,
      5000
    );
    const searchJson = JSON.parse(searchRaw);
    const songs: any[] = searchJson?.result?.songs ?? [];
    if (songs.length === 0) return null;

    for (const song of songs.slice(0, 3)) {
      const lyricRaw = await fetchUrl(
        `https://music.163.com/api/song/lyric?id=${song.id}&lv=1&kv=1&tv=-1`,
        5000
      );
      const lyricJson = JSON.parse(lyricRaw);
      const lrcText: string | undefined = lyricJson?.lrc?.lyric;
      if (lrcText && lrcText.includes('[')) {
        const { lines, hasWordSync } = parseLRC(lrcText);
        if (lines.length > 0) {
          return {
            synced: lines,
            plain: lines.map((l) => l.text).join('\n'),
            source: 'NetEase Synced',
            hasWordSync,
          };
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Provider 6: Paxsenix / Apple-style word-sync API
 */
async function fetchPaxsenix(title: string, artist: string): Promise<LyricsResult | null> {
  try {
    const cleanT = cleanTitle(title);
    const cleanA = cleanArtist(artist);
    const raw = await fetchUrl(
      `https://lyrics.paxsenix.org/search?q=${encodeURIComponent(`${cleanA} ${cleanT}`)}`,
      5000
    );
    const list = JSON.parse(raw);
    const first = Array.isArray(list) ? list[0] : list?.data?.[0];
    if (!first?.id) return null;

    const detailRaw = await fetchUrl(`https://lyrics.paxsenix.org/get?id=${first.id}`, 5000);
    const detail = JSON.parse(detailRaw);
    if (Array.isArray(detail?.content) && detail.content.length > 0) {
      const synced: LyricLine[] = detail.content.map((row: any) => {
        const words: LyricWord[] | undefined = Array.isArray(row.text)
          ? row.text.map((w: any) => ({
              text: String(w.text || ''),
              startTime: Number(w.timestamp || 0) / 1000,
              endTime: Number(w.endtime || 0) / 1000,
            }))
          : undefined;
        return {
          time: Number(row.timestamp || 0) / 1000,
          endTime: row.endtime ? Number(row.endtime) / 1000 : undefined,
          text: words ? words.map((w) => w.text).join('') : String(row.text || ''),
          words,
          isBackground: Boolean(row.background),
        };
      });
      return {
        synced,
        plain: synced.map((l) => l.text).join('\n'),
        source: 'Paxsenix Word-Sync',
        hasWordSync: synced.some((l) => l.words && l.words.length > 0),
      };
    }
    if (typeof detail?.elrc === 'string') {
      const { lines, hasWordSync } = parseLRC(detail.elrc);
      if (lines.length > 0) {
        return { synced: lines, plain: lines.map((l) => l.text).join('\n'), source: 'Paxsenix LRC', hasWordSync };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Built-in Japanese / Korean Hangul / Cyrillic Romanizer (for LyricsRomanisationSettings parity)
 */
const KANA_MAP: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', を: 'wo', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
};

const HANGUL_INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const HANGUL_MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const HANGUL_FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 'h'];

const CYRILLIC_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function romanizeLineIfNonLatin(text: string): string | undefined {
  // Japanese Kana
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
    let out = '';
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      const hira = code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : ch;
      out += KANA_MAP[hira] ?? ch;
    }
    if (out !== text) return out;
  }
  // Korean Hangul Syllables (U+AC00..U+D7A3)
  if (/[\uac00-\ud7a3]/.test(text)) {
    let out = '';
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code >= 0xac00 && code <= 0xd7a3) {
        const s = code - 0xac00;
        const init = Math.floor(s / (21 * 28));
        const med = Math.floor((s % (21 * 28)) / 28);
        const fin = s % 28;
        out += `${HANGUL_INITIAL[init]}${HANGUL_MEDIAL[med]}${HANGUL_FINAL[fin]}`;
      } else {
        out += ch;
      }
    }
    if (out !== text) return out;
  }
  // Cyrillic
  if (/[\u0400-\u04ff]/.test(text)) {
    let out = '';
    for (const ch of text) {
      const lower = ch.toLowerCase();
      const mapped = CYRILLIC_MAP[lower];
      if (mapped !== undefined) {
        out += ch !== lower && mapped ? mapped[0].toUpperCase() + mapped.slice(1) : mapped;
      } else {
        out += ch;
      }
    }
    if (out !== text) return out;
  }
  return undefined;
}

async function enrichLyricsWithRomanizationAndTranslation(
  result: LyricsResult
): Promise<LyricsResult> {
  const settings = getDb().settings;
  if (result.synced.length === 0) return result;

  if (settings.lyricsRomanize) {
    for (const line of result.synced) {
      if (!line.romanized) {
        line.romanized = romanizeLineIfNonLatin(line.text);
      }
    }
  }

  if (settings.lyricsTranslate && result.synced.length <= 120) {
    try {
      const targetLang = settings.lyricsTranslateLang || 'ru';
      const joined = result.synced.map((l) => l.text).join('\n');
      const params = new URLSearchParams({
        client: 'gtx',
        sl: 'auto',
        tl: targetLang,
        dt: 't',
        q: joined,
      });
      const raw = await fetchUrl(
        `https://translate.googleapis.com/translate_a/single?${params.toString()}`,
        5000
      );
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.[0])) {
        const translatedFull = parsed[0].map((part: any) => part?.[0] ?? '').join('');
        const translatedLines = translatedFull.split('\n');
        for (let i = 0; i < Math.min(result.synced.length, translatedLines.length); i++) {
          const tr = translatedLines[i]?.trim();
          if (tr && tr.toLowerCase() !== result.synced[i].text.toLowerCase()) {
            result.synced[i].translation = tr;
          }
        }
      }
    } catch {
      /* translation optional */
    }
  }

  return result;
}

export function setupLyricsIPC(): void {
  ipcMain.handle(
    'lyrics:get',
    async (_e, title: string, artist: string, duration: number, trackId?: string, spotifyRef?: string) => {
      const spotifyId = spotifyTrackId(spotifyRef) || (/^(spotify:|https:\/\/open\.spotify\.com\/)/.test(trackId || '') ? spotifyTrackId(trackId) : undefined);
      const videoId = trackId?.replace(/^youtube:/, '');
      const settings = getDb().settings;
      const cacheKey = `${spotifyId || ''}:${trackId || ''}:${title}:${artist}:${duration}:${settings.lyricsTranslate}:${settings.lyricsRomanize}:${settings.lyricsTranslateLang}`;
      const cached = lyricsCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.result;

      const inFlight = lyricsInFlight.get(cacheKey);
      if (inFlight) return inFlight;

      const lookup = (async (): Promise<LyricsResult> => {
        try {
          const spotify = spotifyId ? await fetchSpotifyLyrics(spotifyId) : null;
          if (spotify?.synced.length) {
            const enriched = await enrichLyricsWithRomanizationAndTranslation(spotify);
            cacheLyrics(cacheKey, enriched, spotifyId);
            return enriched;
          }
          // Waterfall: YouLyPlus (Word-Sync) -> BetterLyrics (TTML Word-Sync) -> Paxsenix (Word-Sync) -> LRCLib -> SimpMusic -> NetEase
          const providers: Array<() => Promise<LyricsResult | null>> = [
            () => fetchYouLyPlus(title, artist, duration),
            () => fetchBetterLyrics(title, artist, duration),
            () => fetchPaxsenix(title, artist),
            () => fetchLRCLib(title, artist, duration),
            ...(videoId && /^[\w-]{11}$/.test(videoId) ? [() => fetchSimpMusic(videoId, duration)] : []),
            () => fetchNetEase(title, artist),
          ];

          let fallbackSynced: LyricsResult | null = spotify;
          for (const runProvider of providers) {
            const res = await runProvider();
            if (res && res.synced.length > 0) {
              if (res.hasWordSync) {
                const enriched = await enrichLyricsWithRomanizationAndTranslation(res);
                cacheLyrics(cacheKey, enriched, spotifyId);
                return enriched;
              }
              if (!fallbackSynced || fallbackSynced.synced.length === 0) fallbackSynced = res;
            } else if (res && res.plain && !fallbackSynced) {
              fallbackSynced = res;
            }
          }

          if (fallbackSynced) {
            const enriched = await enrichLyricsWithRomanizationAndTranslation(fallbackSynced);
            cacheLyrics(cacheKey, enriched, spotifyId);
            return enriched;
          }
        } catch (err) {
          console.error('lyrics:get waterfall error:', err);
        }

        return { synced: [], plain: '', source: 'none', hasWordSync: false };
      })().finally(() => lyricsInFlight.delete(cacheKey));
      lyricsInFlight.set(cacheKey, lookup);
      return lookup;
    }
  );

  ipcMain.handle(
    'lyrics:searchCandidates',
    async (_e, query: string) => {
      try {
        const params = new URLSearchParams({ q: query.trim() });
        const data = await fetchUrl(`https://lrclib.net/api/search?${params.toString()}`, 6000);
        const results = JSON.parse(data);
        if (!Array.isArray(results)) return [];
        return results.slice(0, 10).map((r: any) => ({
          id: r.id,
          trackName: r.trackName,
          artistName: r.artistName,
          albumName: r.albumName,
          duration: r.duration,
          syncedLyrics: r.syncedLyrics || '',
          plainLyrics: r.plainLyrics || '',
        }));
      } catch {
        return [];
      }
    }
  );
}
