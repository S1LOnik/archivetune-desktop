import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useInterfaceMotion } from '../lib/useInterfaceMotion';
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
  RotateCcw,
  AlertCircle,
} from 'lucide-react';
import { usePlayerStore, useUIStore } from '../store';
import { REPEAT_LABELS } from '../lib/interfaceText';
import PlaybackPulse from './PlaybackPulse';
import SeekBar from './SeekBar';
import { usePlayer } from '../lib/usePlayer';

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MiniPlayer() {
  const { reducedMotion, hover, press, controlTransition } = useInterfaceMotion();
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
    loadingStage,
    playbackError,
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
  const { pause, resume, retryCurrentTrack, seek, skipNext, skipPrev, toggleLikeCurrent } = usePlayer();

  const [scrubPosition, setScrubPosition] = useState<number | null>(null);
  if (!currentTrack) return null;

  const displayPosition = scrubPosition ?? position;
  const liked = isTrackLiked(currentTrack);
  const loadingLabel =
    loadingStage === 'slow'
      ? 'Долгий ответ источника…'
      : loadingStage === 'buffering'
        ? 'Запускаем аудио…'
        : 'Запуск…';

  const nextRepeat = () => {
    const modes: Array<'none' | 'one' | 'all'> = ['none', 'all', 'one'];
    const idx = modes.indexOf(repeat);
    setRepeat(modes[(idx + 1) % modes.length]);
  };

  return (
    <div className="player-bar flex flex-col gap-1.5 flex-shrink-0 select-none">
      <SeekBar
        key={currentTrack.id}
        duration={duration}
        position={displayPosition}
        onPreview={setScrubPosition}
        onSeek={seek}
        className="seek-bar-compact text-primary"
      />

      <div className="flex items-center justify-between gap-2 sm:gap-4 min-w-0">
        {/* Track Info */}
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
          <motion.button
            type="button"
            aria-label="Открыть плеер"
            whileHover={hover}
            whileTap={press}
            transition={controlTransition}
            onClick={() => setShowNowPlaying(true)}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl overflow-hidden bg-surface-container-high flex-shrink-0 cursor-pointer relative group shadow-sm"
          >
            {currentTrack.thumbnail ? (
              <img
                src={currentTrack.thumbnail}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-primary text-xl font-bold">
                🎵
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-2xl">
              <ChevronUp size={20} className="text-white" />
            </div>
          </motion.button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => setShowNowPlaying(true)}
                className="text-sm font-bold text-on-surface truncate hover:text-primary transition-colors cursor-pointer leading-snug text-left"
              >
                {currentTrack.title}
              </button>
              {automixing && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center gap-1 flex-shrink-0">
                  <Disc3 size={10} className="animate-spin playback-spinner" />
                  MIX
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-on-surface-variant mt-0.5 min-w-0 flex-wrap">
              <span className="truncate max-w-[140px] sm:max-w-[200px]">{currentTrack.artist}</span>
              {playbackError ? (
                <span role="alert" className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/15 text-red-300 max-w-full">
                  <AlertCircle size={10} className="flex-shrink-0" aria-hidden="true" />
                  <span className="truncate max-w-[120px] sm:max-w-[180px]" title={playbackError}>
                    {playbackError}
                  </span>
                  <button
                    type="button"
                    onClick={() => void retryCurrentTrack()}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-red-500/25 hover:bg-red-500/40 text-red-100 font-bold transition flex-shrink-0"
                    aria-label="Повторить запуск трека"
                  >
                    <RotateCcw size={9} aria-hidden="true" />
                    Повторить
                  </button>
                  <button
                    type="button"
                    onClick={() => setSourceSwitcherTrack(currentTrack)}
                    className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-surface-container-highest hover:brightness-110 text-on-surface font-semibold transition flex-shrink-0"
                    aria-label="Выбрать другой источник"
                  >
                    <ArrowLeftRight size={9} aria-hidden="true" />
                    Источник
                  </button>
                </span>
              ) : loading ? (
                <span
                  role={loadingStage === 'slow' ? 'status' : undefined}
                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    loadingStage === 'slow'
                      ? 'bg-amber-500/20 text-amber-200'
                      : 'bg-primary/15 text-primary'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin playback-spinner flex-shrink-0" aria-hidden="true" />
                  <span className="truncate max-w-[130px] sm:max-w-[200px]">{loadingLabel}</span>
                  {loadingStage === 'slow' && (
                    <button
                      type="button"
                      onClick={() => setSourceSwitcherTrack(currentTrack)}
                      className="px-1.5 py-0.5 rounded-full bg-amber-500/25 hover:bg-amber-500/40 text-amber-100 font-bold transition flex-shrink-0"
                    >
                      Источник
                    </button>
                  )}
                </span>
              ) : resolvedSourceBadge ? (
                <button
                  type="button"
                  onClick={() => setSourceSwitcherTrack(currentTrack)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold transition hover:brightness-110 shadow-sm max-w-[140px] sm:max-w-[220px] ${
                    isLosslessActive
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-surface-container-highest text-primary'
                  }`}
                  title="Выбрать источник звука"
                  aria-label={`Источник звука: ${resolvedSourceBadge}`}
                >
                  <ArrowLeftRight size={9} className="flex-shrink-0" aria-hidden="true" />
                  <span className="truncate">{resolvedSourceBadge}</span>
                </button>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => toggleLikeCurrent(currentTrack)}
            className={`p-2 rounded-full transition-colors flex-shrink-0 hover:bg-surface-container-high ${
              liked ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title={liked ? 'Убрать из любимых' : 'Добавить в любимые'}
            aria-label={liked ? 'Убрать из любимых' : 'Добавить в любимые'}
            aria-pressed={liked}
          >
            <Heart size={16} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={toggleShuffle}
            className={`hidden sm:inline-flex p-2 rounded-full transition-colors hover:bg-surface-container-high ${
              shuffle ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title="Перемешивание"
            aria-label="Перемешивание"
            aria-pressed={shuffle}
          >
            <Shuffle size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={skipPrev}
            className="p-2 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
            title="Предыдущий трек"
            aria-label="Предыдущий трек"
          >
            <SkipBack size={19} aria-hidden="true" />
          </button>

          <motion.button
            type="button"
            onClick={() => {
              if (loading) return;
              if (playbackError) void retryCurrentTrack();
              else void (isPlaying ? pause() : resume());
            }}
            whileHover={loading ? undefined : hover}
            whileTap={loading ? undefined : press}
            transition={controlTransition}
            aria-disabled={loading}
            className={`playback-trigger w-10 h-10 rounded-2xl bg-primary text-on-primary flex items-center justify-center shadow-md shadow-primary/25 ${loading ? 'opacity-85 cursor-wait' : ''}`}
            title={loading ? loadingLabel : playbackError ? 'Повторить запуск' : isPlaying ? 'Пауза' : 'Воспроизвести'}
            aria-label={loading ? loadingLabel : playbackError ? 'Повторить запуск' : isPlaying ? 'Пауза' : 'Воспроизвести'}
            aria-busy={loading}
          >
            <PlaybackPulse />
            {loading ? (
              <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin playback-spinner" />
            ) : playbackError ? (
              <RotateCcw size={17} aria-hidden="true" />
            ) : (
              <motion.span
                key={isPlaying ? 'pause' : 'play'}
                initial={reducedMotion ? false : { scale: 0.72, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={controlTransition}
              >
                {isPlaying ? <Pause size={18} aria-hidden="true" /> : <Play size={18} className="translate-x-0.5" aria-hidden="true" />}
              </motion.span>
            )}
          </motion.button>

          <button
            type="button"
            onClick={skipNext}
            className="p-2 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
            title="Следующий трек"
            aria-label="Следующий трек"
          >
            <SkipForward size={19} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={nextRepeat}
            className={`hidden sm:inline-flex p-2 rounded-full transition-colors relative hover:bg-surface-container-high ${
              repeat !== 'none' ? 'text-primary' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title={`Повтор · ${REPEAT_LABELS[repeat]}`}
            aria-label={`Повтор: ${REPEAT_LABELS[repeat]}`}
          >
            <Repeat size={16} aria-hidden="true" />
            {repeat === 'one' && (
              <span className="absolute top-1 right-1 text-[8px] bg-primary text-on-primary rounded-full w-3 h-3 flex items-center justify-center font-bold">
                1
              </span>
            )}
          </button>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 flex-1 justify-end min-w-0">
          {speed !== 1.0 && (
            <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
              <Gauge size={10} />
              {speed}x
            </span>
          )}
          {(sleepTimerRemainingSec !== null || sleepAfterTrack) && (
            <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold">
              <Moon size={10} />
              {sleepAfterTrack
                ? 'До конца трека'
                : `${Math.ceil((sleepTimerRemainingSec || 0) / 60)} мин`}
            </span>
          )}

          <button
            type="button"
            onClick={() => setAuditTarget({ track: currentTrack, urlOrPath: currentTrack.path })}
            className="hidden md:inline-flex p-2 rounded-full text-on-surface-variant hover:text-primary hover:bg-surface-container-high transition"
            title="Спектр звука"
            aria-label="Спектр звука"
          >
            <Activity size={16} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={toggleQueueDrawer}
            className={`p-2 rounded-full transition hover:bg-surface-container-high ${
              queueDrawerOpen ? 'text-primary bg-primary/15' : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title="Очередь"
            aria-label="Очередь"
            aria-expanded={queueDrawerOpen}
          >
            <ListMusic size={16} aria-hidden="true" />
          </button>

          <span className="text-xs text-on-surface-variant hidden lg:block tabular-nums font-mono">
            {formatTime(displayPosition)} / {formatTime(duration)}
          </span>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                const next = volume > 0 ? 0 : 0.85;
                setVolume(next);
                void window.electronAPI?.player.setVolume(next);
              }}
              aria-label={volume === 0 ? 'Включить звук' : 'Выключить звук'}
              className="text-on-surface-variant hover:text-on-surface transition-colors p-1"
            >
              {volume === 0 ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
            </button>
            <input
              type="range"
              aria-label="Громкость"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                void window.electronAPI?.player.setVolume(v);
              }}
              className="hidden sm:block w-16 md:w-20 accent-primary cursor-pointer h-1.5 rounded-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
