import React from 'react';
import { Play, Pause, Plus, Heart, MoreVertical } from 'lucide-react';
import { usePlayerStore, useUIStore } from '../store';
import { usePlayer } from '../lib/usePlayer';
import type { Track } from '../types/electron';

function formatDuration(s: number): string {
  if (!s || isNaN(s)) return '--:--';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

interface Props {
  track: Track;
  index?: number;
  showIndex?: boolean;
  queue?: Track[];
}

export default function TrackRow({ track, index = 0, showIndex = false, queue }: Props) {
  const { currentTrack, isPlaying, setQueue, addToQueue, isTrackLiked } = usePlayerStore();
  const { setContextMenu, pushToast } = useUIStore();
  const { playTrack, pause, resume, toggleLikeCurrent } = usePlayer();

  const isActive = currentTrack?.id === track.id;
  const liked = isTrackLiked(track);

  const handleClick = async () => {
    if (isActive) {
      if (isPlaying) await pause();
      else await resume();
    } else {
      if (queue) {
        setQueue(queue, index);
      }
      await playTrack(track);
    }
  };

  const openMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  };

  const badgeText =
    track.qualityBadge ||
    track.qualityLabel ||
    (track.lossless ? `${track.codec || 'FLAC'} ${track.bitDepth || 16}bit` : track.source);

  return (
    <div
      onClick={handleClick}
      onContextMenu={openMenu}
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
        isActive
          ? 'bg-primary/15 text-primary'
          : 'hover:bg-surface-container-high text-on-surface'
      }`}
    >
      <div className="w-6 text-center flex-shrink-0">
        {isActive ? (
          isPlaying ? (
            <Pause size={14} className="mx-auto text-primary" />
          ) : (
            <Play size={14} className="mx-auto text-primary" />
          )
        ) : (
          <>
            {showIndex && (
              <span className="text-xs text-on-surface-variant group-hover:hidden">
                {index + 1}
              </span>
            )}
            <Play
              size={14}
              className={`mx-auto text-on-surface-variant ${
                showIndex ? 'hidden group-hover:block' : ''
              }`}
            />
          </>
        )}
      </div>

      <div className="w-10 h-10 rounded-lg overflow-hidden bg-surface-container-high flex-shrink-0">
        {track.thumbnail ? (
          <img src={track.thumbnail} alt={track.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-lg">🎵</div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={`text-sm font-semibold truncate ${isActive ? 'text-primary' : 'text-on-surface'}`}>
            {track.title}
          </p>
          {badgeText && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 uppercase ${
                track.lossless
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-surface-container-highest text-primary'
              }`}
            >
              {badgeText}
            </span>
          )}
        </div>
        <p className="text-xs text-on-surface-variant truncate">{track.artist}</p>
      </div>

      {track.album && (
        <p className="text-xs text-on-surface-variant truncate hidden md:block w-36">
          {track.album}
        </p>
      )}

      <span className="text-xs text-on-surface-variant w-10 text-right flex-shrink-0 tabular-nums">
        {formatDuration(track.duration)}
      </span>

      <button
        onClick={(e) => {
          e.stopPropagation();
          void toggleLikeCurrent(track);
        }}
        className={`p-1.5 rounded-full transition-all ${
          liked
            ? 'text-pink-400 opacity-100'
            : 'text-on-surface-variant opacity-0 group-hover:opacity-100 hover:text-on-surface'
        }`}
        title={liked ? 'Убрать из Любимых' : 'В Любимые'}
      >
        <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          addToQueue(track);
          pushToast(`"${track.title}" добавлен в очередь`, 'info');
        }}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all"
        title="В очередь"
      >
        <Plus size={14} />
      </button>

      <button
        onClick={openMenu}
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-full hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all"
        title="Действия (ПКМ)"
      >
        <MoreVertical size={14} />
      </button>
    </div>
  );
}
