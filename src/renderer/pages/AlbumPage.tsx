import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Disc, Plus } from 'lucide-react';
import TrackRow from '../components/TrackRow';
import { usePlayer } from '../lib/usePlayer';
import { usePlayerStore, useUIStore } from '../store';
import type { Track } from '../types/electron';

export default function AlbumPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playFromQueue } = usePlayer();
  const savePlaylist = usePlayerStore((s) => s.savePlaylist);
  const pushToast = useUIStore((s) => s.pushToast);

  const [loading, setLoading] = useState(true);
  const [album, setAlbum] = useState<{
    title: string;
    artist: string;
    thumbnail: string;
    year?: string;
    tracks: Track[];
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    window.electronAPI?.ytmusic
      ?.getAlbum(decodeURIComponent(id))
      .then((res) => setAlbum(res))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="p-8 text-sm text-on-surface-variant">Загрузка альбома...</div>;
  }

  if (!album) {
    return (
      <div className="p-8 space-y-3">
        <button onClick={() => navigate(-1)} className="text-xs text-primary flex items-center gap-1">
          <ArrowLeft size={14} /> Назад
        </button>
        <p className="text-sm text-on-surface-variant">Не удалось загрузить альбом.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="text-xs font-semibold text-on-surface-variant hover:text-on-surface flex items-center gap-1.5"
      >
        <ArrowLeft size={15} /> Назад
      </button>

      <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-end bg-surface-container rounded-3xl p-6 border border-outline-variant/25">
        <div className="w-44 h-44 rounded-2xl overflow-hidden bg-surface-container-high shadow-xl flex-shrink-0">
          {album.thumbnail ? (
            <img src={album.thumbnail} alt={album.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-4xl">
              <Disc size={44} className="text-primary" />
            </div>
          )}
        </div>
        <div className="space-y-2 flex-1 min-w-0">
          <span className="text-[11px] font-bold uppercase tracking-widest text-primary">Альбом</span>
          <h1 className="text-2xl sm:text-3xl font-black text-on-surface leading-tight">
            {album.title}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {album.artist} {album.year ? `• ${album.year}` : ''} • {album.tracks.length} треков
          </p>
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => void playFromQueue(album.tracks, 0)}
              className="px-5 py-2.5 rounded-2xl bg-primary text-on-primary text-xs font-bold inline-flex items-center gap-2 shadow-lg"
            >
              <Play size={15} /> Воспроизвести
            </button>
            <button
              onClick={() => {
                savePlaylist({
                  id: `album:${id}`,
                  name: album.title,
                  description: album.artist,
                  thumbnail: album.thumbnail,
                  source: 'youtube',
                  tags: ['Album'],
                  trackCount: album.tracks.length,
                  tracks: album.tracks,
                  updatedAt: Date.now(),
                });
                pushToast(`Альбом "${album.title}" сохранён в плейлисты`, 'info');
              }}
              className="px-4 py-2.5 rounded-2xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Plus size={14} /> В библиотеку
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        {album.tracks.map((t, i) => (
          <TrackRow key={`${t.id}_${i}`} track={t} index={i} showIndex queue={album.tracks} />
        ))}
      </div>
    </div>
  );
}
