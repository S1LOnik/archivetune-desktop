import React, { useEffect, useState } from 'react';
import { X, Tag, Image as ImageIcon, Save } from 'lucide-react';
import { useUIStore, useLibraryStore } from '../store';

export default function TagEditorModal() {
  const { tagEditorTrack, setTagEditorTrack, pushToast } = useUIStore();
  const updateTrackLocalMeta = useLibraryStore((s) => s.updateTrackLocalMeta);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [year, setYear] = useState('');
  const [genre, setGenre] = useState('');
  const [trackNumber, setTrackNumber] = useState('');
  const [coverPreview, setCoverPreview] = useState<string | undefined>();
  const [coverPath, setCoverPath] = useState<string | undefined>();

  useEffect(() => {
    if (!tagEditorTrack?.path) return;
    setLoading(true);
    setCoverPath(undefined);
    window.electronAPI?.tagEditor
      ?.read(tagEditorTrack.path)
      .then((info) => {
        if (info) {
          setTitle(info.title || '');
          setArtist(info.artist || '');
          setAlbum(info.album || '');
          setYear(info.year || '');
          setGenre(info.genre || '');
          setTrackNumber(info.trackNumber || '');
          setCoverPreview(info.coverDataUrl || tagEditorTrack.thumbnail);
        } else {
          setTitle(tagEditorTrack.title);
          setArtist(tagEditorTrack.artist);
          setAlbum(tagEditorTrack.album || '');
          setCoverPreview(tagEditorTrack.thumbnail);
        }
      })
      .finally(() => setLoading(false));
  }, [tagEditorTrack]);

  if (!tagEditorTrack || !tagEditorTrack.path) return null;

  const handlePickCover = async () => {
    const file = await window.electronAPI?.tagEditor?.pickCover();
    if (file) {
      setCoverPath(file);
      setCoverPreview(`file://${file}`);
    }
  };

  const handleSave = async () => {
    if (!tagEditorTrack.path) return;
    setSaving(true);
    try {
      const res = await window.electronAPI?.tagEditor?.write(tagEditorTrack.path, {
        title,
        artist,
        album,
        year,
        genre,
        trackNumber,
        coverPath,
      });
      if (res?.ok) {
        updateTrackLocalMeta(tagEditorTrack.path, {
          title,
          artist,
          album: album || undefined,
          ...(coverPath ? { thumbnail: `file://${coverPath}` } : {}),
        });
        pushToast('Теги аудиофайла сохранены.', 'info');
        setTagEditorTrack(null);
      } else {
        pushToast(res?.error || 'Не удалось записать теги.', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[115] bg-black/75 backdrop-blur-md flex items-center justify-center p-4"
      onClick={() => setTagEditorTrack(null)}
    >
      <div
        className="w-full max-w-lg bg-surface-container   rounded-3xl shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
            <Tag size={17} className="text-primary" />
            Редактор аудио-тегов (FFmpeg Lossless Copy)
          </h2>
          <button
            onClick={() => setTagEditorTrack(null)}
            className="p-1.5 rounded-xl hover:bg-surface-container-high text-on-surface-variant"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-on-surface-variant">Чтение тегов...</div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-2xl overflow-hidden bg-surface-container-high flex-shrink-0">
                {coverPreview ? (
                  <img src={coverPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">🎵</div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <p className="text-[11px] text-on-surface-variant truncate">{tagEditorTrack.path}</p>
                <button
                  onClick={handlePickCover}
                  className="px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold text-on-surface inline-flex items-center gap-1.5"
                >
                  <ImageIcon size={14} /> Выбрать обложку
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 text-xs">
              <label className="space-y-1">
                <span className="text-on-surface-variant font-medium">Название</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="space-y-1">
                <span className="text-on-surface-variant font-medium">Исполнитель</span>
                <input
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <label className="space-y-1">
                <span className="text-on-surface-variant font-medium">Альбом</span>
                <input
                  value={album}
                  onChange={(e) => setAlbum(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none focus:ring-1 focus:ring-primary"
                />
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="space-y-1">
                  <span className="text-on-surface-variant font-medium">Год</span>
                  <input
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-on-surface-variant font-medium">Жанр</span>
                  <input
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-on-surface-variant font-medium">Трек №</span>
                  <input
                    value={trackNumber}
                    onChange={(e) => setTrackNumber(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setTagEditorTrack(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:bg-surface-container-high"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-on-primary inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save size={14} /> {saving ? 'Сохранение...' : 'Сохранить теги'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
