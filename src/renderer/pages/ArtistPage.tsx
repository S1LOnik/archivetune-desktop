import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, User, Disc } from 'lucide-react';
import TrackRow from '../components/TrackRow';
import { usePlayer } from '../lib/usePlayer';
import type { Track } from '../types/electron';

export default function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { playFromQueue } = usePlayer();

  const [loading, setLoading] = useState(true);
  const [artist, setArtist] = useState<{
    name: string;
    thumbnail: string;
    subscribers?: string;
    songs: Track[];
    albums: any[];
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    window.electronAPI?.ytmusic
      ?.getArtist(decodeURIComponent(id))
      .then((res) => setArtist(res))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="p-8 text-sm text-on-surface-variant">Загрузка профиля артиста...</div>;
  }

  if (!artist) {
    return (
      <div className="p-8 space-y-3">
        <button onClick={() => navigate(-1)} className="text-xs text-primary flex items-center gap-1">
          <ArrowLeft size={14} /> Назад
        </button>
        <p className="text-sm text-on-surface-variant">Артист не найден.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-7">
      <button
        onClick={() => navigate(-1)}
        className="text-xs font-semibold text-on-surface-variant hover:text-on-surface flex items-center gap-1.5"
      >
        <ArrowLeft size={15} /> Назад
      </button>

      <div className="flex items-center gap-6 bg-surface-container rounded-3xl p-6  ">
        <div className="w-36 h-36 rounded-full overflow-hidden bg-surface-container-high shadow-xl flex-shrink-0">
          {artist.thumbnail ? (
            <img src={artist.thumbnail} alt={artist.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <User size={42} className="text-primary" />
            </div>
          )}
        </div>
        <div className="space-y-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-primary">
            Исполнитель
          </span>
          <h1 className="text-3xl font-black text-on-surface">{artist.name}</h1>
          {artist.subscribers && (
            <p className="text-xs text-on-surface-variant">{artist.subscribers}</p>
          )}
          {artist.songs.length > 0 && (
            <button
              onClick={() => void playFromQueue(artist.songs, 0)}
              className="mt-2 px-5 py-2.5 rounded-2xl bg-primary text-on-primary text-xs font-bold inline-flex items-center gap-2 shadow-lg"
            >
              <Play size={15} /> Играть популярное
            </button>
          )}
        </div>
      </div>

      {artist.songs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
            Популярные треки
          </h2>
          {artist.songs.map((t, i) => (
            <TrackRow key={`${t.id}_${i}`} track={t} index={i} showIndex queue={artist.songs} />
          ))}
        </section>
      )}

      {artist.albums.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant flex items-center gap-1.5">
            <Disc size={15} className="text-primary" /> Дискография и релизы
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-4">
            {artist.albums.map((al, i) => (
              <div
                key={`${al.id}_${i}`}
                onClick={() => navigate(`/album/${encodeURIComponent(al.id)}`)}
                className="p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high   cursor-pointer transition"
              >
                <div className="aspect-square rounded-xl overflow-hidden bg-surface-container-highest mb-2">
                  {al.thumbnail ? (
                    <img src={al.thumbnail} alt={al.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-2xl">💿</div>
                  )}
                </div>
                <p className="text-xs font-bold text-on-surface truncate">{al.title}</p>
                <p className="text-[11px] text-on-surface-variant truncate">{al.subtitle}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
