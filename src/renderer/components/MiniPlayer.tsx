import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Shuffle,
  ChevronUp,
  Moon,
  Gauge,
  Heart,
  Disc3,
  ArrowLeftRight,
  ListMusic,
  Activity,
} from 'lucide-react';
import { usePlayerStore, useUIStore } from '../store';
import { usePlayer } from '../lib/usePlayer';

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MiniPlayer() {
  const {
    currentTrack,
    isPlaying,
    automixing,
    resolvedSourceBadge,
    isLosslessActive,
    position,
    duration,
    volume,
    repeat,
    shuffle,
    loading,
    speed,
    sleepTimerRemainingSec,
    sleepAfterTrack,
    setVolume,
    setRepeat,
    toggleShuffle,
    isTrackLiked,
  } = usePlayerStore();
  const {
    setShowNowPlaying,
    setSourceSwitcherTrack,
    setAuditTarget,
    toggleQueueDrawer,
    queueDrawerOpen,
  } = useUIStore();
  const { pause, resume, seek, skipNext, skipPrev, toggleLikeCurrent } = usePlayer();

  if (!currentTrack) return null;

  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;
  const liked = isTrackLiked(currentTrack);

  const nextRepeat = () => {
    const modes: Array<'none' | 'one' | 'all'> = ['none', 'all', 'one'];
    const idx = modes.indexOf(repeat);
    setRepeat(modes[(idx + 1) % modes.length]);
  };

  return (
    <div className="player-bar flex flex-col gap-1.5 flex-shrink-0 select-none">
      {/* Progress bar */}
      <div
        className="w-full h-1.5 bg-surface-container-highest/80 rounded-full cursor-pointer relative group transition-all hover:h-2"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          if (duration > 0) void seek(ratio * duration);
        }}
      >
        <div
          className="h-full bg-gradient-to-r from-primary to-rose-400 rounded-full transition-all"
          style={{ width: `${progress * 100}%` }}
        />
        <div
          className="w-3.5 h-3.5 bg-white rounded-full absolute -top-1 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity shadow-md pointer-events-none"
          style={{ left: `${progress * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        {/* Track Info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            onClick={() => setShowNowPlaying(true)}
            className="w-12 h-12 rounded-2xl overflow-hidden bg-surface-container-high flex-shrink-0 cursor-pointer relative group shadow-sm"
          >
            {currentTrack.thumbnail ? (
              <img
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-primary text-xl font-bold">
                🎵
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-2xl">
              <ChevronUp size={20} className="text-white" />
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p
                onClick={() => setShowNowPlaying(true)}
                className="text-sm font-bold text-on-surface truncate hover:text-primary transition-colors cursor-pointer leading-snug"
              >
                {currentTrack.title}
              </p>
              {automixing && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center gap-1 flex-shrink-0">
                  <Disc3 size={10} className="animate-spin" />
                  MIX
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-on-surface-variant mt-0.5">
              <span className="truncate">{currentTrack.artist}</span>
              {resolvedSourceBadge && (
                <button
                  onClick={() => setSourceSwitcherTrack(currentTrack)}
                  className={`hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition hover:brightness-110 shadow-sm ${
                    isLosslessActive
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-surface-container-highest text-primary'
                  }`}
                  title="Переключить источник потока (Multi-Source Matrix)"
                >
                  <ArrowLeftRight size={9} />
                  {resolvedSourceBadge}
                </button>
              )}
            </div>
          </div>

          <button
            onClick={() => toggleLikeCurrent(currentTrack)}
            className={`p-2 rounded-full transition-colors flex-shrink-0 hover:bg-surface-container-high ${
              liked ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title={liked ? 'Убрать из Любимых' : 'В Любимые'}
          >
            <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleShuffle}
            className={`p-2 rounded-full transition-colors hover:bg-surface-container-high ${
              shuffle ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title="Перемешать"
          >
            <Shuffle size={16} />
          </button>

          <button
            onClick={skipPrev}
            className="p-2 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
            title="Предыдущий"
          >
            <SkipBack size={19} />
          </button>

          <button
            onClick={() => (isPlaying ? pause() : resume())}
            disabled={loading}
            className="w-10 h-10 rounded-2xl bg-gradient-to-r from-primary to-rose-400 text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-md shadow-primary/25 disabled:opacity-50"
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {loading ? (
              <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            ) : isPlaying ? (
              <Pause size={18} />
            ) : (
              <Play size={18} className="translate-x-0.5" />
            )}
          </button>

          <button
            onClick={skipNext}
            className="p-2 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
            title="Следующий"
          >
            <SkipForward size={19} />
          </button>

          <button
            onClick={nextRepeat}
            className={`p-2 rounded-full transition-colors relative hover:bg-surface-container-high ${
              repeat !== 'none' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title={`Повтор: ${repeat}`}
          >
            <Repeat size={16} />
            {repeat === 'one' && (
              <span className="absolute 1 top-1 right-1 text-[8px] bg-primary text-white rounded-full w-3 h-3 flex items-center justify-center font-bold">
                1
              </span>
            )}
          </button>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2.5 flex-1 justify-end">
          {speed !== 1.0 && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
              <Gauge size={10} />
              {speed}x
            </span>
          )}
          {(sleepTimerRemainingSec !== null || sleepAfterTrack) && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
              <Moon size={10} />
              {sleepAfterTrack
                ? 'EOT'
                : `${Math.ceil((sleepTimerRemainingSec || 0) / 60)}m`}
            </span>
          )}

          <button
            onClick={() => setAuditTarget({ track: currentTrack, urlOrPath: currentTrack.path })}
            className="p-2 rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition"
            title="Акустический аудит качества (FFT)"
          >
            <Activity size={16} />
          </button>

          <button
            onClick={toggleQueueDrawer}
            className={`p-2 rounded-full transition hover:bg-surface-container-high ${
              queueDrawerOpen ? 'text-primary bg-primary/15' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title="Очередь и AutoMix"
          >
            <ListMusic size={16} />
          </button>

          <span className="text-xs text-on-surface-variant hidden sm:block tabular-nums font-mono">
            {formatTime(position)} / {formatTime(duration)}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const next = volume > 0 ? 0 : 0.85;
                setVolume(next);
                void window.electronAPI?.player.setVolume(next);
              }}
              className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
            >
              {volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                void window.electronAPI?.player.setVolume(v);
              }}
              className="w-20 accent-primary cursor-pointer h-1.5 rounded-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
