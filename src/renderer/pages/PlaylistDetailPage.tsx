import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Download, Plus, Tag } from 'lucide-react';
import TrackRow from '../components/TrackRow';
import { usePlayer } from '../lib/usePlayer';
import { usePlayerStore, useUIStore } from '../store';
import type { Track, PlaylistItem } from '../types/electron';

export default function PlaylistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playFromQueue } = usePlayer();
  const { playlists, savePlaylist } = usePlayerStore();
  const pushToast = useUIStore((s) => s.pushToast);

  const decodedId = id ? decodeURIComponent(id) : '';
  const localPlaylist = playlists.find((p) => p.id === decodedId);

  const [loading, setLoading] = useState(!localPlaylist);
  const [remoteData, setRemoteData] = useState<{
    title: string;
    author?: string;
    thumbnail?: string;
    tracks: Track[];
  } | null>(null);
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    if (localPlaylist || !decodedId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    window.electronAPI?.ytmusic
      ?.getPlaylist(decodedId)
      .then((res) => setRemoteData(res))
      .finally(() => setLoading(false));
  }, [decodedId, Boolean(localPlaylist)]);

  const title = localPlaylist?.name || remoteData?.title || 'Плейлист';
  const subtitle = localPlaylist?.description || remoteData?.author || '';
  const thumbnail = localPlaylist?.thumbnail || remoteData?.thumbnail;
  const tracks = localPlaylist?.tracks || remoteData?.tracks || [];

  const handleExport = async (fmt: 'm3u8' | 'json') => {
    if (!localPlaylist) return;
    const res = await window.electronAPI?.playlists?.export(localPlaylist.id, fmt);
    if (res?.ok) pushToast(`Экспортировано: ${res.filePath}`, 'info');
  };

  const handleAddTag = () => {
    if (!localPlaylist || !newTag.trim()) return;
    const tags = Array.from(new Set([...(localPlaylist.tags || []), newTag.trim()]));
    const updated: PlaylistItem = { ...localPlaylist, tags, updatedAt: Date.now() };
    savePlaylist(updated);
    setNewTag('');
  };

  if (loading) {
    return <div className="p-8 text-sm text-on-surface-variant">Загрузка плейлиста...</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="text-xs font-semibold text-on-surface-variant hover:text-on-surface flex items-center gap-1.5"
      >
        <ArrowLeft size={15} /> Назад
      </button>

      <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-end bg-surface-container rounded-3xl p-6  ">
        <div className="w-40 h-40 rounded-2xl overflow-hidden bg-surface-container-high shadow-xl flex-shrink-0">
          {thumbnail ? (
            <img src={thumbnail} alt={title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-4xl">🎶</div>
          )}
        </div>
        <div className="space-y-2 flex-1 min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-widest text-primary">
            Плейлист
          </span>
          <h1 className="text-2xl sm:text-3xl font-black text-on-surface">{title}</h1>
          <p className="text-xs text-on-surface-variant">
            {subtitle ? `${subtitle} • ` : ''}
            {tracks.length} треков
          </p>

          {localPlaylist && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {(localPlaylist.tags || []).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold inline-flex items-center gap-1"
                >
                  <Tag size={10} /> {tag}
                </span>
              ))}
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                placeholder="+ тег"
                className="px-2 py-0.5 text-[11px] rounded-full bg-surface-container-high text-on-surface w-20 outline-none"
              />
            </div>
          )}

          <div className="flex items-center gap-2.5 pt-2 flex-wrap">
            {tracks.length > 0 && (
              <button
                onClick={() => void playFromQueue(tracks, 0)}
                className="px-5 py-2.5 rounded-2xl bg-primary text-on-primary text-xs font-bold inline-flex items-center gap-2 shadow-lg"
              >
                <Play size={15} /> Воспроизвести
              </button>
            )}
            {!localPlaylist && remoteData && (
              <button
                onClick={() => {
                  savePlaylist({
                    id: decodedId,
                    name: title,
                    description: subtitle,
                    thumbnail,
                    source: 'youtube',
                    tags: ['YouTube'],
                    trackCount: tracks.length,
                    tracks,
                    updatedAt: Date.now(),
                  });
                  pushToast(`Плейлист "${title}" сохранён в библиотеку`, 'info');
                }}
                className="px-4 py-2.5 rounded-2xl bg-surface-container-high text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Plus size={14} /> Сохранить
              </button>
            )}
            {localPlaylist && (
              <>
                <button
                  onClick={() => void handleExport('m3u8')}
                  className="px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Download size={13} /> M3U8
                </button>
                <button
                  onClick={() => void handleExport('json')}
                  className="px-3.5 py-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold inline-flex items-center gap-1.5"
                >
                  <Download size={13} /> JSON
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        {tracks.map((t, i) => (
          <TrackRow key={`${t.id}_${i}`} track={t} index={i} showIndex queue={tracks} />
        ))}
      </div>
    </div>
  );
}
