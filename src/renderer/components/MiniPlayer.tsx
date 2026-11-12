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
    <div className="bg-surface-container/95 backdrop-blur-xl border-t border-outline-variant/40 px-4 py-2 flex flex-col gap-1 flex-shrink-0">
      {/* Progress bar */}
      <div
        className="w-full h-1.5 bg-surface-container-highest rounded-full cursor-pointer relative group"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          if (duration > 0) void seek(ratio * duration);
        }}
      >
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${progress * 100}%` }}
        />
        <div
          className="w-3 h-3 bg-primary rounded-full absolute -top-1 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity shadow"
          style={{ left: `${progress * 100}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        {/* Track Info */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div
            onClick={() => setShowNowPlaying(true)}
            className="w-11 h-11 rounded-xl overflow-hidden bg-surface-container-high flex-shrink-0 cursor-pointer relative group"
          >
            {currentTrack.thumbnail ? (
              <img
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-primary text-lg">
                🎵
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <ChevronUp size={18} className="text-white" />
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p
                onClick={() => setShowNowPlaying(true)}
                className="text-sm font-bold text-on-surface truncate hover:text-primary transition-colors cursor-pointer"
              >
                {currentTrack.title}
              </p>
              {automixing && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 flex items-center gap-1 flex-shrink-0">
                  <Disc3 size={10} className="animate-spin" />
                  MIX
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-on-surface-variant">
              <span className="truncate">{currentTrack.artist}</span>
              {resolvedSourceBadge && (
                <button
                  onClick={() => setSourceSwitcherTrack(currentTrack)}
                  className={`hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold transition hover:brightness-110 ${
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
            className={`p-1.5 rounded-full transition-colors flex-shrink-0 ${
              liked ? 'text-pink-400' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title={liked ? 'Убрать из Любимых' : 'В Любимые'}
          >
            <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
          </button>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleShuffle}
            className={`p-1.5 rounded-full transition-colors ${
              shuffle ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title="Перемешать"
          >
            <Shuffle size={15} />
          </button>

          <button
            onClick={skipPrev}
            className="p-1.5 rounded-full text-on-surface-variant hover:text-on-surface transition-colors"
            title="Предыдущий"
          >
            <SkipBack size={18} />
          </button>

          <button
            onClick={() => (isPlaying ? pause() : resume())}
            disabled={loading}
            className="w-9 h-9 rounded-full bg-primary text-on-primary flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-50 shadow-md shadow-primary/20"
            title={isPlaying ? 'Пауза' : 'Воспроизвести'}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause size={17} />
            ) : (
              <Play size={17} className="translate-x-0.5" />
            )}
          </button>

          <button
            onClick={skipNext}
            className="p-1.5 rounded-full text-on-surface-variant hover:text-on-surface transition-colors"
            title="Следующий"
          >
            <SkipForward size={18} />
          </button>

          <button
            onClick={nextRepeat}
            className={`p-1.5 rounded-full transition-colors relative ${
              repeat !== 'none' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title={`Повтор: ${repeat}`}
          >
            <Repeat size={15} />
            {repeat === 'one' && (
              <span className="absolute -top-0.5 -right-0.5 text-[9px] bg-primary text-on-primary rounded-full w-3 h-3 flex items-center justify-center font-bold">
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
            className="p-1.5 rounded-full text-on-surface-variant hover:text-primary transition"
            title="Акустический аудит качества (FFT)"
          >
            <Activity size={15} />
          </button>

          <button
            onClick={toggleQueueDrawer}
            className={`p-1.5 rounded-full transition ${
              queueDrawerOpen ? 'text-primary bg-primary/15' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title="Очередь и AutoMix"
          >
            <ListMusic size={15} />
          </button>

          <span className="text-xs text-on-surface-variant hidden sm:block tabular-nums">
            {formatTime(position)} / {formatTime(duration)}
          </span>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const next = volume > 0 ? 0 : 0.85;
                setVolume(next);
                void window.electronAPI?.player.setVolume(next);
              }}
              className="text-on-surface-variant hover:text-on-surface transition-colors"
            >
              {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
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
              className="w-20 accent-primary cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
