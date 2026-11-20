/**
 * automix.ts — Full Smart DJ Automix, Real PCM Spectral Flux Analyzer, Planner,
 *              Jaro-Winkler TitleMatch & Acoustic Quality Auditor
 *
 * Direct TypeScript port of S1LOnik/ArchiveTune:
 * - playback/automix/AutoMixAnalyzer.kt
 * - playback/automix/AutoMixPlanner.kt
 * - playback/automix/SmartDjAutomixManager.kt
 * - audiosource/AudioSourceConfig.kt (TitleMatch & TrackMatching)
 * - acoustics/AcousticQualityAuditor.kt
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { runAudioDsp } from './audioDspClient';

function decodePcmSegment(source: string, maxSeconds = 45, sampleRate = 22050, startSec = 0, signal?: AbortSignal): Promise<Float32Array<ArrayBuffer> | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const args: string[] = ['-v', 'quiet'];
    if (startSec > 0) args.push('-ss', String(startSec));
    args.push('-i', source, '-t', String(maxSeconds), '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1');

    const child = execFile('ffmpeg', args, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 15000, signal }, (err, stdout) => {
      if (err || !stdout || stdout.length < 4096 || signal?.aborted) {
        return resolve(null);
      }
      const alignedLen = stdout.length - (stdout.length % 4);
      const floatView = new Float32Array(stdout.buffer, stdout.byteOffset, alignedLen / 4);
      resolve(new Float32Array(floatView));
    });
    child.on('error', () => resolve(null));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Real AutoMixAnalyzer & AutoMixPlanner (BPM, Beat Grid, Energy, Vocal Guard)
// ═══════════════════════════════════════════════════════════════════════════════

export interface AutoMixAnalysis {
  trackId: string;
  durationMs: number;
  bpm: number;
  beatConfidence: number;
  beatIntervalMs: number;
  firstDownbeatMs: number;
  onsetMs: number;
  trailingSilenceMs: number;
  energyCurve: number[]; // sampled every 500ms
  vocalCurve: number[]; // 300-3400Hz band ratio every 500ms
  isUsable: boolean;
}

export type AutoMixPlanStyle = 'GAPLESS' | 'DJ_BLEND' | 'FILTER_RIDE' | 'EQUAL_POWER';

export interface AutoMixPlan {
  blocked: boolean;
  reason: string;
  style: AutoMixPlanStyle;
  transitionStartMs: number;
  transitionEndMs: number;
  fadeMs: number;
  incomingCueMs: number;
  incomingPlaybackRate: number;
  bassSwap: boolean;
  bassSwapFraction: number;
  filterSweep: number;
  vocalOverlap: number;
  outBpm?: number;
  inBpm?: number;
}

const analysisCache = new Map<string, AutoMixAnalysis>();

function getAutomixStoreDir(): string {
  try {
    return path.join(app.getPath('userData'), 'automix_analysis');
  } catch {
    return path.join(os.tmpdir(), 'archivetune-automix');
  }
}

export async function analyzeAudioForAutomix(trackId: string, sourceUrlOrPath: string, durationSec: number, signal?: AbortSignal): Promise<AutoMixAnalysis | null> {
  if (!trackId || !sourceUrlOrPath || signal?.aborted) return null;
  const cached = analysisCache.get(trackId);
  if (cached) return cached;

  const storeDir = getAutomixStoreDir();
  const safeHash = crypto.createHash('md5').update(trackId).digest('hex');
  const cacheFile = path.join(storeDir, `${safeHash}.json`);

  try {
    if (fs.existsSync(cacheFile)) {
      const disk = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as AutoMixAnalysis;
      analysisCache.set(trackId, disk);
      return disk;
    }
  } catch { /* ignore */ }

  const isLocal = !/^https?:\/\//i.test(sourceUrlOrPath) && fs.existsSync(sourceUrlOrPath);
  const analysisRate = isLocal ? 22050 : 11025;
  const fftSize = isLocal ? 1024 : 512;

  const samples = await decodePcmSegment(sourceUrlOrPath, 35, analysisRate, 0, signal);
  if (signal?.aborted || !samples || samples.length < fftSize * 4) return null;

  const features = await runAudioDsp({ kind: 'automix', samples, sampleRate: analysisRate, fftSize });
  if (signal?.aborted) return null;

  // Measure trailing silence on local files
  let trailingSilenceMs = 900;
  if (isLocal && durationSec > 10) {
    const tail = await decodePcmSegment(sourceUrlOrPath, 8, 11025, Math.max(0, durationSec - 8), signal);
    if (signal?.aborted) return null;
    if (tail && tail.length > 0) {
      let silentSamples = 0;
      for (let i = tail.length - 1; i >= 0; i--) {
        if (Math.abs(tail[i]) > 0.008) break;
        silentSamples++;
      }
      trailingSilenceMs = Math.min(6000, Math.round((silentSamples * 1000) / 11025));
    }
  }

  const result: AutoMixAnalysis = {
    trackId,
    durationMs: Math.max(1000, Math.round(durationSec * 1000)),
    ...features,
    trailingSilenceMs,
    isUsable: features.bpm >= 55 && features.bpm <= 200 && features.energyCurve.length >= 4,
  };

  analysisCache.set(trackId, result);
  try {
    if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(result), 'utf-8');
  } catch { /* ignore */ }

  return result;
}

export const AutoMixPlanner = {
  plan(opts: {
    current: AutoMixAnalysis | null;
    next: AutoMixAnalysis | null;
    outDurationMs: number;
    fallbackFadeMs: number;
    minFadeMs?: number;
    gaplessAlbum?: boolean;
    preferredStyle?: 'auto' | 'dj_blend' | 'filter_ride' | 'equal_power' | 'gapless';
  }): AutoMixPlan {
    const minFadeMs = opts.minFadeMs ?? 2500;
    const baseFadeMs = Math.max(minFadeMs, Math.min(16000, opts.fallbackFadeMs));

    if (opts.preferredStyle === 'gapless' || opts.gaplessAlbum) {
      return {
        blocked: false,
        reason: opts.gaplessAlbum ? 'Gapless Album Sequence' : 'Gapless Transition',
        style: 'GAPLESS',
        transitionStartMs: Math.max(0, opts.outDurationMs - 150),
        transitionEndMs: opts.outDurationMs,
        fadeMs: 0,
        incomingCueMs: opts.next?.onsetMs ?? 0,
        incomingPlaybackRate: 1.0,
        bassSwap: false,
        bassSwapFraction: 0.5,
        filterSweep: 0,
        vocalOverlap: 0,
      };
    }

    if (opts.preferredStyle === 'equal_power' || !opts.current?.isUsable || !opts.next?.isUsable) {
      const trailing = opts.current?.trailingSilenceMs ?? 900;
      const startMs = Math.max(0, opts.outDurationMs - trailing - baseFadeMs);
      return {
        blocked: false,
        reason: 'S-Curve Equal Power Fade',
        style: 'EQUAL_POWER',
        transitionStartMs: startMs,
        transitionEndMs: startMs + baseFadeMs,
        fadeMs: baseFadeMs,
        incomingCueMs: opts.next?.onsetMs ?? 200,
        incomingPlaybackRate: 1.0,
        bassSwap: false,
        bassSwapFraction: 0.5,
        filterSweep: 0,
        vocalOverlap: 0,
        outBpm: opts.current?.bpm,
        inBpm: opts.next?.bpm,
      };
    }

    const cur = opts.current;
    const nxt = opts.next;
    const tempoRatio = cur.bpm > 1 && nxt.bpm > 1 ? nxt.bpm / cur.bpm : 1.0;
    const canBeatMatch =
      (opts.preferredStyle === 'dj_blend' || opts.preferredStyle === 'auto' || !opts.preferredStyle) &&
      cur.beatConfidence >= 0.45 &&
      nxt.beatConfidence >= 0.45 &&
      Math.abs(tempoRatio - 1.0) <= 0.14;

    if (canBeatMatch) {
      const beatMs = cur.beatIntervalMs || Math.round(60000 / Math.max(40, cur.bpm));
      const availableMs = Math.max(minFadeMs, opts.outDurationMs - cur.trailingSilenceMs - 1500);
      const alignedMs = SmartDjAutomixManager.alignDurationToPhrase(cur.bpm, Math.min(baseFadeMs, availableMs));

      // Align transition start to downbeat phase
      const downbeatMs = cur.firstDownbeatMs || 0;
      const rawStart = Math.max(0, opts.outDurationMs - cur.trailingSilenceMs - alignedMs);
      const beatsSinceDownbeat = Math.max(0, Math.round((rawStart - downbeatMs) / beatMs));
      const startMs = downbeatMs + Math.round(beatsSinceDownbeat * beatMs);

      // Estimate vocal overlap score using normalized 300-3400Hz curves
      const curVocal = cur.vocalCurve || [];
      const nxtVocal = nxt.vocalCurve || [];
      const outTailVocal = curVocal.slice(-6).reduce((a, b) => a + b, 0) / Math.max(1, curVocal.slice(-6).length);
      const inHeadVocal = nxtVocal.slice(0, 6).reduce((a, b) => a + b, 0) / Math.max(1, nxtVocal.slice(0, 6).length);
      const vocalOverlap = Math.min(1, outTailVocal + inHeadVocal);

      const finalFadeMs = vocalOverlap > 0.65 ? Math.max(minFadeMs, Math.round(alignedMs * 0.65)) : alignedMs;
      const rateAlignment = Math.max(0.88, Math.min(1.12, cur.bpm / nxt.bpm));

      // Pick quietest beat fraction in middle third [0.35..0.65] for Bass Swap
      const energyCurve = cur.energyCurve || [];
      const midIdx = Math.max(0, energyCurve.length - Math.ceil(finalFadeMs / 500));
      let quietFrac = 0.5;
      if (midIdx < energyCurve.length - 2) {
        const sub = energyCurve.slice(midIdx);
        let minVal = Infinity;
        let minI = Math.floor(sub.length / 2);
        sub.forEach((v, i) => {
          if (i >= Math.floor(sub.length * 0.25) && i <= Math.ceil(sub.length * 0.75) && v < minVal) {
            minVal = v;
            minI = i;
          }
        });
        quietFrac = Math.max(0.3, Math.min(0.7, minI / Math.max(1, sub.length - 1)));
      }

      return {
        blocked: false,
        reason: `Smart DJ Blend (${cur.bpm.toFixed(1)} -> ${nxt.bpm.toFixed(1)} BPM, Bass Swap ${(quietFrac * 100).toFixed(0)}%)`,
        style: 'DJ_BLEND',
        transitionStartMs: startMs,
        transitionEndMs: startMs + finalFadeMs,
        fadeMs: finalFadeMs,
        incomingCueMs: nxt.onsetMs,
        incomingPlaybackRate: rateAlignment,
        bassSwap: true,
        bassSwapFraction: quietFrac,
        filterSweep: 0,
        vocalOverlap,
        outBpm: cur.bpm,
        inBpm: nxt.bpm,
      };
    }

    // Filter Ride fallback when BPMs diverge significantly
    const fadeMs = Math.min(10000, baseFadeMs);
    const startMs = Math.max(0, opts.outDurationMs - cur.trailingSilenceMs - fadeMs);
    return {
      blocked: false,
      reason: `Filter Ride Sweep (${cur.bpm.toFixed(0)} vs ${nxt.bpm.toFixed(0)} BPM)`,
      style: 'FILTER_RIDE',
      transitionStartMs: startMs,
      transitionEndMs: startMs + fadeMs,
      fadeMs,
      incomingCueMs: nxt.onsetMs,
      incomingPlaybackRate: 1.0,
      bassSwap: true,
      bassSwapFraction: 0.5,
      filterSweep: 0.8,
      vocalOverlap: 0.2,
      outBpm: cur.bpm,
      inBpm: nxt.bpm,
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SmartDjAutomixManager (Phrase alignment, Tempo Warp, S-Curve & Bass Swap)
// ═══════════════════════════════════════════════════════════════════════════════

export interface TrackRhythm {
  bpm: number;
  firstDownbeatMs: number;
  timeSignature: number;
}

export interface AutomixGains {
  outgoingGain: number;
  incomingGain: number;
  outgoingBassCut: boolean;
  incomingBassCut: boolean;
  outgoingLowpassHz?: number;
}

export interface PlaybackWarpGains {
  outgoingSpeed: number;
  incomingSpeed: number;
}

const DEFAULT_BPM = 120.0;
const DEFAULT_MUSIC_ONSET_MS = 200;
const DEFAULT_TRAILING_SILENCE_MS = 1200;
const MIN_AUTOMIX_DURATION_MS = 2500;
const MAX_AUTOMIX_DURATION_MS = 16000;
const MAX_TEMPO_WARP_RATIO_DELTA = 0.15;

class SmartDjAutomixManagerImpl {
  private rhythmCache = new Map<string, TrackRhythm>();
  private silenceBoundaryCache = new Map<string, { onsetMs: number; trailingSilenceMs: number }>();

  public getMusicOnsetMs(mediaId: string): number {
    const analyzed = analysisCache.get(mediaId);
    if (analyzed) return analyzed.onsetMs;
    const cached = this.silenceBoundaryCache.get(mediaId);
    return cached ? cached.onsetMs : DEFAULT_MUSIC_ONSET_MS;
  }

  public getAudibleEndMs(mediaId: string, durationMs: number): number {
    if (durationMs <= 0) return durationMs;
    const analyzed = analysisCache.get(mediaId);
    const cached = this.silenceBoundaryCache.get(mediaId);
    const trailingSilence = analyzed ? analyzed.trailingSilenceMs : cached ? cached.trailingSilenceMs : DEFAULT_TRAILING_SILENCE_MS;
    return Math.max(Math.floor(durationMs / 2), durationMs - trailingSilence);
  }

  public recordAudioBoundaries(mediaId: string, onsetMs: number, trailingSilenceMs: number): void {
    this.silenceBoundaryCache.set(mediaId, {
      onsetMs: Math.max(0, onsetMs),
      trailingSilenceMs: Math.max(0, trailingSilenceMs),
    });
  }

  private stringHashCode(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  public resolveRhythmSync(mediaId: string, title = '', artists = '', knownBpm?: number): TrackRhythm {
    const analyzed = analysisCache.get(mediaId);
    if (analyzed && analyzed.isUsable) {
      return { bpm: analyzed.bpm, firstDownbeatMs: analyzed.firstDownbeatMs, timeSignature: 4 };
    }
    const existing = this.rhythmCache.get(mediaId);
    if (existing) return existing;

    if (knownBpm && knownBpm > 40 && knownBpm < 240) {
      const rhythm: TrackRhythm = { bpm: knownBpm, firstDownbeatMs: 0, timeSignature: 4 };
      this.rhythmCache.set(mediaId, rhythm);
      return rhythm;
    }

    const hash = this.stringHashCode(`${mediaId}${title}${artists}`);
    const estimatedBpm = 88.0 + (hash % 52);
    const fallbackRhythm: TrackRhythm = { bpm: estimatedBpm, firstDownbeatMs: 0, timeSignature: 4 };
    this.rhythmCache.set(mediaId, fallbackRhythm);
    return fallbackRhythm;
  }

  public alignDurationToPhrase(bpm: number, targetDurationMs: number): number {
    const safeBpm = bpm >= 40 && bpm <= 240 ? bpm : DEFAULT_BPM;
    const barMs = (60000.0 / safeBpm) * 4.0;
    const candidates = [Math.round(barMs * 2), Math.round(barMs * 4), Math.round(barMs * 8)].filter(
      (c) => c >= MIN_AUTOMIX_DURATION_MS && c <= MAX_AUTOMIX_DURATION_MS
    );
    if (candidates.length === 0) {
      return Math.max(MIN_AUTOMIX_DURATION_MS, Math.min(MAX_AUTOMIX_DURATION_MS, targetDurationMs));
    }
    let best = candidates[0];
    let bestDiff = Math.abs(best - targetDurationMs);
    for (const c of candidates) {
      const d = Math.abs(c - targetDurationMs);
      if (d < bestDiff) {
        best = c;
        bestDiff = d;
      }
    }
    return best;
  }

  public calculateDownbeatSyncSeek(incomingOnsetMs: number, outgoingPositionMs: number, outgoingRhythm: TrackRhythm): number {
    const safeOutgoingBpm = outgoingRhythm.bpm >= 40 && outgoingRhythm.bpm <= 240 ? outgoingRhythm.bpm : DEFAULT_BPM;
    const beatMs = 60000.0 / safeOutgoingBpm;
    const outgoingPhaseMs = Math.max(0, (outgoingPositionMs - outgoingRhythm.firstDownbeatMs) % beatMs);
    return Math.max(incomingOnsetMs, Math.round(incomingOnsetMs + outgoingPhaseMs));
  }

  public calculateTempoWarpParameters(progress: number, outgoingBpm: number, incomingBpm: number): PlaybackWarpGains {
    if (outgoingBpm < 40 || outgoingBpm > 240 || incomingBpm < 40 || incomingBpm > 240) {
      return { outgoingSpeed: 1.0, incomingSpeed: 1.0 };
    }
    const ratio = incomingBpm / outgoingBpm;
    if (Math.abs(ratio - 1.0) > MAX_TEMPO_WARP_RATIO_DELTA) {
      return { outgoingSpeed: 1.0, incomingSpeed: 1.0 };
    }
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const outgoingSpeed = 1.0 + (ratio - 1.0) * clampedProgress * 0.5;
    const initialIncomingSpeed = 1.0 / ratio;
    const incomingSpeed = initialIncomingSpeed + (1.0 - initialIncomingSpeed) * clampedProgress;
    return {
      outgoingSpeed: Math.max(0.85, Math.min(1.15, outgoingSpeed)),
      incomingSpeed: Math.max(0.85, Math.min(1.15, incomingSpeed)),
    };
  }

  public calculateAutomixGains(progress: number, bassSwapFraction = 0.5, style: AutoMixPlanStyle = 'DJ_BLEND'): AutomixGains {
    const p = Math.max(0, Math.min(1, progress));
    const outgoingAngle = Math.min(Math.PI / 2.0, p * (Math.PI / 2.0) * 1.15);
    const incomingAngle = p * (Math.PI / 2.0) * 0.88;
    const outgoingGain = Math.max(0, Math.min(1.0, Math.cos(outgoingAngle)));
    const incomingGain = Math.max(0, Math.min(1.0, Math.sin(incomingAngle)));
    const bassSwap = style === 'DJ_BLEND' || style === 'FILTER_RIDE';
    const outgoingBassCut = bassSwap ? p >= bassSwapFraction : false;
    const incomingBassCut = bassSwap ? p < bassSwapFraction : false;
    const outgoingLowpassHz = style === 'FILTER_RIDE' ? Math.round(18000 - p * 16500) : undefined;
    return { outgoingGain, incomingGain, outgoingBassCut, incomingBassCut, outgoingLowpassHz };
  }
}

export const SmartDjAutomixManager = new SmartDjAutomixManagerImpl();

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TitleMatch (Jaro-Winkler) & TrackMatching
// ═══════════════════════════════════════════════════════════════════════════════

const SPECIFIC_MODIFIERS = [
  'hardstyle', 'nightcore', 'daycore', 'slowed', 'reverb', 'speed up', 'sped up',
  'flip', 'mashup', 'cover', 'acoustic', 'instrumental', 'vip', 'bass boosted',
  '8d', 'bootleg', 'tribute', 'parody', 'live', 'demo', 'phonk', 'hardtekk',
  'radio edit', 'radio mix',
];
const VERSION_TOKENS = [...SPECIFIC_MODIFIERS, 'remix', 'edit', 'mix', 'version'];

const RECORDING_VERSION = /(?:^| )(?:remix|rework|edit|mix|extended|dub|hardstyle|nightcore|daycore|slowed|reverb|speed up|sped up|speedup|flip|mashup|cover|acoustic|instrumental|karaoke|vip|bass boosted|8d|bootleg|tribute|parody|live|demo|phonk|hardtekk|unplugged|session|ремикс|ремиксе|микс|кавер|лайв|акустика|акустическая|замедленная|замедлено|ускоренная|ускорено|караоке)(?= |$)/u;

function recordingTitleKey(title: string): string {
  return title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .replace(/\b(?:speed up|speedup)\b/g, 'sped up');
}

function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  const maxDist = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);
  let matches = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (!s2Matches[j] && s1[i] === s2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3.0;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + 0.1 * prefix * (1.0 - jaro);
}

// Compare catalog names across Cyrillic and Latin spellings without weakening
// title, version, or duration checks for alternate recordings.
function transliterateCyrillic(value: string): string {
  const letters: Record<string, string> = {
    а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'i',
    к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f',
    х:'kh', ц:'ts', ч:'ch', ш:'sh', щ:'shch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya',
    і:'i', ї:'yi', є:'ye', ґ:'g', ў:'u',
  };
  return value.toLowerCase().replace(/[а-яёіїєґў]/g, (char) => letters[char] ?? char);
}

export const TitleMatch = {
  normalize(value?: string | null): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\b(feat|ft|featuring)\b.*$/i, '')
      .replace(/\b(explicit|clean|remaster|remastered|version|audio|official)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  cleanTitle(title: string): string {
    return title.replace(/\s*[([{\-–—|:]?\s*(?:official(?: music)? (?:audio|video)|lyrics? video|official visuali[sz]er|официальное видео)\s*[)\]}]?\s*$/iu, '').trim();
  },

  hasVersionMismatch(wanted: string, candidate: string): boolean {
    const wantedKey = recordingTitleKey(this.cleanTitle(wanted));
    const candidateKey = recordingTitleKey(this.cleanTitle(candidate));
    return wantedKey !== candidateKey && (RECORDING_VERSION.test(wantedKey) || RECORDING_VERSION.test(candidateKey));
  },

  ratio(wanted?: string | null, candidate?: string | null): number {
    const a = this.normalize(wanted);
    const b = this.normalize(candidate);
    if (!a || !b) return 0.0;
    if (a === b) return 1.0;
    const fuzzy = (x: string, y: string): number => {
      const direct = jaroWinkler(x, y);
      const transX = transliterateCyrillic(x);
      const transY = transliterateCyrillic(y);
      return Math.max(direct, jaroWinkler(transX, transY));
    };
    const direct = fuzzy(a, b);
    const segA = (wanted || '').split(/\s*[-/|:]\s*/).map((s) => this.normalize(s)).filter((s) => s.length >= 3);
    const segB = (candidate || '').split(/\s*[-/|:]\s*/).map((s) => this.normalize(s)).filter((s) => s.length >= 3);
    let best = direct;
    for (const sa of segA) best = Math.max(best, fuzzy(sa, b));
    for (const sb of segB) best = Math.max(best, fuzzy(a, sb));
    return best;
  },

  evaluate(params: {
    wantedTitle: string;
    wantedArtists: string[];
    wantedAlbum?: string;
    wantedDurationMs?: number;
    candidateTitle: string;
    candidateArtist?: string;
    candidateAlbum?: string;
    candidateDurationMs?: number;
  }): { accepted: boolean; score: number; reason: string } {
    if (!params.candidateTitle) return { accepted: false, score: 0, reason: 'missing title' };
    if (this.hasVersionMismatch(params.wantedTitle, params.candidateTitle)) {
      return { accepted: false, score: 0, reason: 'version mismatch' };
    }
    const titleScore = this.ratio(this.cleanTitle(params.wantedTitle), this.cleanTitle(params.candidateTitle));
    const wantedArtistStr = params.wantedArtists.join(', ');
    const candidateArtist = params.candidateArtist?.replace(/\s*[-–—]\s*Topic$/i, '');
    if (RECORDING_VERSION.test(recordingTitleKey(this.cleanTitle(params.wantedTitle))) &&
      transliterateCyrillic(this.normalize(wantedArtistStr)) !== transliterateCyrillic(this.normalize(candidateArtist))) {
      return { accepted: false, score: 0, reason: 'version credits mismatch' };
    }
    const artistScore = wantedArtistStr && candidateArtist
      ? Math.max(...params.wantedArtists.map(artist => this.ratio(artist, candidateArtist)), this.ratio(wantedArtistStr, candidateArtist))
      : 0.7;

    let durScore = 0.7;
    if (params.wantedDurationMs && params.candidateDurationMs && params.wantedDurationMs > 0 && params.candidateDurationMs > 0) {
      const diff = Math.abs(params.wantedDurationMs - params.candidateDurationMs);
      const maxDifference = Math.min(20000, params.wantedDurationMs * 0.15);
      if (diff > maxDifference) return { accepted: false, score: 0, reason: 'duration mismatch' };
      durScore = diff <= 3000 ? 1.0 : diff <= 10000 ? 0.85 : 0.65;
    }

    if (artistScore < 0.68) return { accepted: false, score: 0, reason: 'artist mismatch' };
    if (titleScore < 0.78) return { accepted: false, score: titleScore * 0.5, reason: 'title similarity too low' };

    const albumScore = params.wantedAlbum && params.candidateAlbum ? this.ratio(params.wantedAlbum, params.candidateAlbum) : 0.5;
    const score = titleScore * 0.45 + artistScore * 0.3 + durScore * 0.2 + albumScore * 0.05;
    return {
      accepted: score >= 0.74,
      score,
      reason: score >= 0.74 ? 'matched' : 'composite score too low',
    };
  },
};

export interface MatchTarget {
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
}

export interface MatchCandidate<T = unknown> {
  id: string;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  payload: T;
}

const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'feat', 'ft', 'featuring', 'with']);

export const TrackMatching = {
  normalize(value?: string | null): string {
    if (!value) return '';
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\u0400-\u04ff]+/g, ' ')
      .trim();
  },
  normalizeTitle(value: string): string {
    return this.normalize(value)
      .replace(/\b(feat|ft|featuring)\b.*$/i, '')
      .replace(/\b(explicit|clean|remaster|remastered|version|audio|official|video|lyric|lyrics|hd|4k)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },
  significantTokens(value: string): Set<string> {
    return new Set(value.split(' ').map((t) => t.trim()).filter((t) => t.length >= 2 && !STOP_WORDS.has(t)));
  },
  tokenOverlap(wanted: Set<string>, candidate: Set<string>): number {
    if (wanted.size === 0 || candidate.size === 0) return 0;
    let shared = 0;
    for (const w of wanted) if (candidate.has(w)) shared++;
    return shared / Math.max(wanted.size, candidate.size);
  },
  hasVersionMismatch(wanted: string, candidate: string): boolean {
    const wPadded = ` ${wanted} `;
    const cPadded = ` ${candidate} `;
    return VERSION_TOKENS.some((token) => wPadded.includes(` ${token} `) !== cPadded.includes(` ${token} `));
  },
  durationMatches(wantedDurationMs?: number, candidateDurationMs?: number): boolean {
    if (!wantedDurationMs || !candidateDurationMs || wantedDurationMs <= 0 || candidateDurationMs <= 0) return true;
    return Math.abs(wantedDurationMs - candidateDurationMs) <= 45000;
  },
  score(
    wantedTitle: string,
    wantedArtists: string[],
    candidateTitle: string,
    candidateArtist: string,
    wantedDurationMs?: number,
    candidateDurationMs?: number
  ): number {
    if (!wantedTitle || !candidateTitle) return -9999;
    if (this.hasVersionMismatch(wantedTitle, candidateTitle)) return -9999;
    const titleOverlap = this.tokenOverlap(this.significantTokens(wantedTitle), this.significantTokens(candidateTitle));
    if (titleOverlap < 0.5) return -9999;
    let totalScore = Math.floor(titleOverlap * 100);
    if (wantedArtists.length > 0 && candidateArtist) {
      const candArtistTokens = this.significantTokens(candidateArtist);
      let maxArtistOverlap = 0;
      for (const a of wantedArtists) {
        const ov = this.tokenOverlap(this.significantTokens(a), candArtistTokens);
        if (ov > maxArtistOverlap) maxArtistOverlap = ov;
      }
      totalScore += Math.floor(maxArtistOverlap * 60);
    }
    if (wantedDurationMs && candidateDurationMs && wantedDurationMs > 0 && candidateDurationMs > 0) {
      totalScore += this.durationMatches(wantedDurationMs, candidateDurationMs) ? 30 : -40;
    }
    return totalScore;
  },
  best<T>(target: MatchTarget, candidates: MatchCandidate<T>[]): MatchCandidate<T> | null {
    const normWantedTitle = this.normalizeTitle(target.title);
    const normWantedArtists = target.artists.map((a) => this.normalize(a)).filter(Boolean);
    let bestCandidate: MatchCandidate<T> | null = null;
    let bestScore = 59;
    for (const candidate of candidates) {
      const s = this.score(
        normWantedTitle,
        normWantedArtists,
        this.normalizeTitle(candidate.title),
        this.normalize(candidate.artists.join(' ')),
        target.durationMs,
        candidate.durationMs
      );
      if (s > bestScore) {
        bestScore = s;
        bestCandidate = candidate;
      }
    }
    return bestCandidate;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// 5. AcousticQualityAuditor (Direct port of AcousticQualityAuditor.kt)
// ═══════════════════════════════════════════════════════════════════════════════

export interface AcousticAuditReport {
  verdict: 'TRUE_LOSSLESS' | 'UPSCALED_LOSSY' | 'SUSPECTED_FAKE';
  cutoffHz: number;
  rollOffHz: number;
  nyquistHz: number;
  sampleRate: number;
  highBandEnergyRatio: number;
  isTrueLossless: boolean;
}

export async function auditTrackAcousticQuality(sourceUrlOrPath: string): Promise<AcousticAuditReport | null> {
  const sampleRate = 44100;
  const samples = await decodePcmSegment(sourceUrlOrPath, 25, sampleRate, 15);
  if (!samples || samples.length < 4096 * 4) {
    const fallbackSamples = await decodePcmSegment(sourceUrlOrPath, 25, sampleRate, 0);
    if (!fallbackSamples || fallbackSamples.length < 4096 * 2) return null;
    return runAudioDsp({ kind: 'audit', samples: fallbackSamples, sampleRate });
  }
  return runAudioDsp({ kind: 'audit', samples, sampleRate });
}
