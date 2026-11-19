import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  ListPlus,
  ListStart,
  ArrowLeftRight,
  Radio,
  Disc,
  User,
  Activity,
  Download,
  Ban,
  FolderPlus,
  Tag,
  Heart,
} from 'lucide-react';
import { useUIStore, usePlayerStore } from '../store';
import { usePlayer } from '../lib/usePlayer';

export default function TrackContextMenu() {
  const {
    contextMenu,
    setContextMenu,
    setSourceSwitcherTrack,
    setAuditTarget,
    setTagEditorTrack,
    pushToast,
  } = useUIStore();
  const {
    playlists,
    addToQueue,
    insertNextInQueue,
    addTrackToPlaylist,
    toggleBlockArtist,
    toggleLike,
    isTrackLiked,
  } = usePlayerStore();
  const { playTrack, startRadio } = usePlayer();
  const navigate = useNavigate();

  const [showPlaylistSub, setShowPlaylistSub] = useState(false);

  useEffect(() => {
    setShowPlaylistSub(false);
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu, setContextMenu]);

  if (!contextMenu) return null;

  const { track, x, y } = contextMenu;
  const liked = isTrackLiked(track);

  const clampedX = Math.min(x, window.innerWidth - 260);
  const clampedY = Math.min(y, window.innerHeight - 390);

  const handleDownload = async () => {
    setContextMenu(null);
    pushToast(`Скачивание "${track.title}"...`, 'info');
    try {
      const res = await window.electronAPI.player.downloadTrack(track);
      if (res.ok) pushToast(`Сохранено: ${res.filePath}`, 'lossless');
      else pushToast(res.error || 'Ошибка загрузки', 'error');
    } catch {
      pushToast('Ошибка при загрузке трека', 'error');
    }
  };

  return (
    <div
      className="fixed z-[130] w-60 bg-surface-container-highest/95 backdrop-blur-xl   rounded-2xl shadow-2xl py-1.5 text-xs text-on-surface"
      style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5   mb-1">
        <p className="font-bold truncate">{track.title}</p>
        <p className="text-[11px] text-on-surface-variant truncate">{track.artist}</p>
      </div>

      {track.source !== 'local' && <MenuBtn
        icon={<Download size={14} />}
        label="Сохранить офлайн"
        onClick={async () => {
          setContextMenu(null);
          pushToast(`Сохраняю «${track.title}» на устройство…`, 'info');
          try {
            const result = await window.electronAPI.offline.save(track);
            pushToast(result.ok ? 'Трек сохранён в разделе «Загрузки»' : result.error || 'Ошибка сохранения', result.ok ? 'success' : 'error');
          } catch { pushToast('Не удалось сохранить трек офлайн', 'error'); }
        }}
      />}
      <MenuBtn
        icon={<Play size={14} />}
        label="Воспроизвести сейчас"
        onClick={() => {
          setContextMenu(null);
          void playTrack(track);
        }}
      />
      <MenuBtn
        icon={<ListStart size={14} />}
        label="Включить следующим"
        onClick={() => {
          insertNextInQueue(track);
          setContextMenu(null);
          pushToast('Добавлено следующим в очередь', 'info');
        }}
      />
      <MenuBtn
        icon={<ListPlus size={14} />}
        label="Добавить в очередь"
        onClick={() => {
          addToQueue(track);
          setContextMenu(null);
          pushToast('Добавлено в очередь', 'info');
        }}
      />
      <MenuBtn
        icon={<Heart size={14} fill={liked ? 'currentColor' : 'none'} className={liked ? 'text-pink-400' : ''} />}
        label={liked ? 'Убрать из любимых' : 'Добавить в любимые'}
        onClick={() => {
          toggleLike(track);
          setContextMenu(null);
        }}
      />

      <div className="relative">
        <MenuBtn
          icon={<FolderPlus size={14} />}
          label={`В плейлист (${playlists.length}) ▸`}
          onClick={() => setShowPlaylistSub((s) => !s)}
        />
        {showPlaylistSub && (
          <div className="mx-2 my-1 p-1 rounded-xl bg-surface-container max-h-36 overflow-y-auto space-y-0.5  ">
            {playlists.length === 0 ? (
              <div className="px-2 py-1 text-[11px] text-on-surface-variant">Нет плейлистов</div>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => {
                    addTrackToPlaylist(pl.id, track);
                    setContextMenu(null);
                    pushToast(`Добавлено в "${pl.name}"`, 'info');
                  }}
                  className="w-full text-left px-2 py-1 rounded-lg hover:bg-surface-container-high truncate"
                >
                  {pl.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="my-1  " />

      <MenuBtn
        icon={<ArrowLeftRight size={14} className="text-primary" />}
        label="Переключить источник (Matrix)"
        onClick={() => {
          setSourceSwitcherTrack(track);
          setContextMenu(null);
        }}
      />
      <MenuBtn
        icon={<Radio size={14} />}
        label="Запустить радио по треку"
        onClick={() => {
          setContextMenu(null);
          void startRadio(track);
        }}
      />
      {track.albumId && (
        <MenuBtn
          icon={<Disc size={14} />}
          label="Перейти к альбому"
          onClick={() => {
            setContextMenu(null);
            navigate(`/album/${encodeURIComponent(track.albumId!)}`);
          }}
        />
      )}
      {track.artistId && (
        <MenuBtn
          icon={<User size={14} />}
          label="Перейти к артисту"
          onClick={() => {
            setContextMenu(null);
            navigate(`/artist/${encodeURIComponent(track.artistId!)}`);
          }}
        />
      )}

      <div className="my-1  " />

      <MenuBtn
        icon={<Activity size={14} />}
        label="Акустический аудит (FFT)"
        onClick={() => {
          setAuditTarget({ track, urlOrPath: track.path });
          setContextMenu(null);
        }}
      />
      {track.source === 'local' && track.path && (
        <MenuBtn
          icon={<Tag size={14} />}
          label="Редактор тегов / обложки"
          onClick={() => {
            setTagEditorTrack(track);
            setContextMenu(null);
          }}
        />
      )}
      {track.source !== 'local' && (
        <MenuBtn icon={<Download size={14} />} label="Скачать" onClick={handleDownload} />
      )}
      <MenuBtn
        icon={<Ban size={14} className="text-red-400" />}
        label={`Скрыть артиста "${track.artist}"`}
        onClick={() => {
          toggleBlockArtist(track.artist);
          setContextMenu(null);
          pushToast(`Артист "${track.artist}" добавлен в чёрный список`, 'info');
        }}
      />
    </div>
  );
}

function MenuBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-1.5 flex items-center gap-2.5 hover:bg-primary/15 text-left transition"
    >
      <span className="text-on-surface-variant">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
