import React, { useEffect, useState } from 'react';
import { X, RefreshCw, CheckCircle2, Sparkles, ArrowRight } from 'lucide-react';
import { useUIStore, usePlayerStore } from '../store';
import { usePlayer } from '../lib/usePlayer';
import type { MultiTrackCandidate, AudioSourceId } from '../types/electron';

const SOURCE_COLORS: Record<string, string> = {
  tidal: 'bg-cyan-500/20 text-cyan-300 border-cyan-400/30',
  qobuz: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/30',
  deezer: 'bg-purple-500/20 text-purple-300 border-purple-400/30',
  jiosaavn: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30',
  youtube: 'bg-red-500/20 text-red-300 border-red-400/30',
  soundcloud: 'bg-orange-500/20 text-orange-300 border-orange-400/30',
  apple: 'bg-pink-500/20 text-pink-300 border-pink-400/30',
  spotify: 'bg-green-500/20 text-green-300 border-green-400/30',
};

function fmtDur(sec: number) {
  if (!sec) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function SourceSwitcherModal() {
  const { sourceSwitcherTrack, setSourceSwitcherTrack, pushToast } = useUIStore();
  const {
    resolvedSourceId,
    currentTrack,
    autoUpgradeLossless,
    setAutoUpgradeLossless,
    setDspOption,
  } = usePlayerStore();
  const { playTrack } = usePlayer();

  const [candidates, setCandidates] = useState<MultiTrackCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [threshold, setThreshold] = useState<number>(88);

  useEffect(() => {
    window.electronAPI?.db?.getInitialState?.().then((db) => {
      if (typeof db?.settings?.autoSwitchThreshold === 'number') {
        setThreshold(db.settings.autoSwitchThreshold);
      }
    });
  }, []);

  const loadCandidates = async () => {
    if (!sourceSwitcherTrack || !window.electronAPI?.providers?.findAlternatives) return;
    setLoading(true);
    try {
      const list = await window.electronAPI.providers.findAlternatives({
        id: sourceSwitcherTrack.id,
        title: sourceSwitcherTrack.title,
        artist: sourceSwitcherTrack.artist,
        album: sourceSwitcherTrack.album,
        duration: sourceSwitcherTrack.duration,
      });
      setCandidates(list || []);
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (sourceSwitcherTrack) void loadCandidates();
  }, [sourceSwitcherTrack?.id]);

  if (!sourceSwitcherTrack) return null;

  const handleSelectCandidate = async (cand: MultiTrackCandidate) => {
    const targetTrack = {
      ...sourceSwitcherTrack,
      id: cand.id,
      source: cand.source,
      thumbnail: cand.thumbnail || sourceSwitcherTrack.thumbnail,
      duration: cand.duration || sourceSwitcherTrack.duration,
    };
    setSourceSwitcherTrack(null);
    pushToast(`Переключение на ${cand.source.toUpperCase()} (${cand.qualityLabel})...`, 'switch');
    await playTrack(targetTrack, cand.source as AudioSourceId);
  };

  const quickSources: AudioSourceId[] = ['tidal', 'qobuz', 'deezer', 'youtube', 'jiosaavn', 'soundcloud'];

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={() => setSourceSwitcherTrack(null)}
    >
      <div
        className="w-full max-w-2xl bg-surface-container border border-outline-variant/40 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-outline-variant/20 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <Sparkles size={17} className="text-primary" />
              Умный переключатель источников (Multi-Source Matrix)
            </h2>
            <p className="text-xs text-on-surface-variant truncate max-w-lg mt-0.5">
              {sourceSwitcherTrack.title} — {sourceSwitcherTrack.artist}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadCandidates}
              disabled={loading}
              className="p-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant"
              title="Обновить поиск"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={() => setSourceSwitcherTrack(null)}
              className="p-2 rounded-xl hover:bg-surface-container-high text-on-surface-variant"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Smart Auto-Switch Bar + Instant force-source buttons */}
        <div className="px-6 py-3 bg-surface-container-high/70 border-b border-outline-variant/15 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoUpgradeLossless(!autoUpgradeLossless)}
                className={`px-3 py-1 rounded-xl text-xs font-bold border transition ${
                  autoUpgradeLossless
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40'
                    : 'bg-surface-container text-on-surface-variant border-outline-variant/30'
                }`}
              >
                {autoUpgradeLossless ? '✓ Авто-выбор лучшего ВКЛ' : 'Авто-выбор лучшего ВЫКЛ'}
              </button>
              <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                <span>Порог схожести:</span>
                <input
                  type="range"
                  min={70}
                  max={98}
                  step={1}
                  value={threshold}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setThreshold(val);
                    setDspOption({ autoSwitchThreshold: val });
                  }}
                  className="w-24 accent-primary cursor-pointer"
                />
                <span className="font-bold text-primary tabular-nums">{threshold}%</span>
              </div>
            </div>

            {candidates.length > 0 && (
              <button
                onClick={() => void handleSelectCandidate(candidates[0])}
                className="px-3 py-1 rounded-xl text-xs font-bold bg-primary text-on-primary hover:opacity-90 transition flex items-center gap-1.5"
              >
                <Sparkles size={12} />
                Выбрать лучший ({candidates[0].source.toUpperCase()} • {candidates[0].qualityLabel})
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mr-1">
              Быстро:
            </span>
            {quickSources.map((src) => (
              <button
                key={src}
                onClick={() => {
                  setSourceSwitcherTrack(null);
                  void playTrack(sourceSwitcherTrack, src);
                }}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition hover:brightness-110 ${
                  SOURCE_COLORS[src] || 'bg-surface-container text-on-surface border-outline-variant/30'
                }`}
              >
                {src.toUpperCase()}
                {currentTrack?.id === sourceSwitcherTrack.id && resolvedSourceId === src && ' • ACTIVE'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {loading ? (
            <div className="py-12 text-center text-sm text-on-surface-variant">
              Поиск совпадений по Tidal, Qobuz, Deezer, YTM, JioSaavn и SoundCloud...
            </div>
          ) : candidates.length === 0 ? (
            <div className="py-12 text-center text-sm text-on-surface-variant">
              Совпадений не найдено. Попробуйте кнопки быстрого переключения выше.
            </div>
          ) : (
            candidates.map((cand) => {
              const rawScore = cand.matchScore ?? 85;
              const scorePct = Math.min(100, Math.round(rawScore > 1 ? rawScore : rawScore * 100));
              const isActive =
                currentTrack?.id === cand.id ||
                (currentTrack?.id === sourceSwitcherTrack.id && resolvedSourceId === cand.source);

              return (
                <button
                  key={`${cand.source}:${cand.id}`}
                  onClick={() => void handleSelectCandidate(cand)}
                  className="w-full text-left flex items-center gap-3 p-3 rounded-2xl bg-surface-container-high/60 hover:bg-surface-container-highest border border-outline-variant/20 transition group"
                >
                  <div className="w-11 h-11 rounded-xl overflow-hidden bg-surface-container flex-shrink-0">
                    {cand.thumbnail ? (
                      <img src={cand.thumbnail} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs">🎵</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          SOURCE_COLORS[cand.source] || 'bg-surface-container text-on-surface'
                        }`}
                      >
                        {cand.source.toUpperCase()}
                      </span>
                      <span className="text-sm font-semibold text-on-surface truncate">
                        {cand.title}
                      </span>
                      {cand.lossless && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300">
                          LOSSLESS
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-on-surface-variant truncate mt-0.5">
                      {cand.artist} {cand.album ? `• ${cand.album}` : ''} • {cand.qualityLabel} •{' '}
                      {fmtDur(cand.duration)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                        scorePct >= 85
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : scorePct >= 65
                          ? 'bg-amber-500/15 text-amber-300'
                          : 'bg-surface-container text-on-surface-variant'
                      }`}
                    >
                      {scorePct}% match
                    </span>
                    {isActive ? (
                      <CheckCircle2 size={18} className="text-primary" />
                    ) : (
                      <ArrowRight
                        size={16}
                        className="text-on-surface-variant group-hover:text-primary transition"
                      />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
