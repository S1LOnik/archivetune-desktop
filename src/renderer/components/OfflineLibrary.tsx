import React, { useEffect, useState } from 'react';
import { Download, HardDrive, Play, RefreshCw, Trash2 } from 'lucide-react';
import { usePlayerStore, useUIStore } from '../store';
import { usePlayer } from '../lib/usePlayer';
import type { Track } from '../types/electron';

type Entry = { track: Track; filePath: string; bytes: number; savedAt: number };
export default function OfflineLibrary({ query }: { query: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const { playTrack } = usePlayer();
  const load = async () => {
    try { setEntries(await window.electronAPI.offline.list()); setError(''); }
    catch { setError('Не удалось открыть сохранённую музыку'); }
  };
  useEffect(() => { void load(); }, []);
  const visible = entries.filter(e => `${e.track.title} ${e.track.artist}`.toLowerCase().includes(query.toLowerCase()));
  const local = (e: Entry): Track => ({ ...e.track, source: 'local', path: e.filePath });
  const play = (index: number) => {
    const tracks = visible.map(local);
    usePlayerStore.getState().setQueue(tracks, index);
    void playTrack(tracks[index]);
  };
  const remove = async (entry: Entry) => {
    setBusy(entry.track.id);
    try {
      const result = await window.electronAPI.offline.remove(entry.track.id);
      if (!result.ok) throw new Error(result.error);
      await load();
    } catch (error: any) { useUIStore.getState().pushToast(error.message, 'error'); }
    finally { setBusy(null); }
  };
  return <section className="space-y-5">
    <div className="flex items-center justify-between gap-4 p-5 rounded-3xl bg-surface-container">
      <div><h2 className="font-bold flex items-center gap-2"><HardDrive size={18} /> Сохранено на устройстве</h2>
        <p className="text-xs text-on-surface-variant mt-2">{entries.length} треков · {(entries.reduce((sum, e) => sum + e.bytes, 0) / 1024 / 1024).toFixed(1)} МБ · доступны без интернета</p>
      </div>
      <button onClick={() => void load()} aria-label="Обновить сохранённые треки" className="p-3 rounded-full hover:bg-surface-container-high"><RefreshCw size={17} /></button>
    </div>
    {error && <p role="alert" className="text-error text-sm">{error}</p>}
    {visible.length > 0 ? <div className="space-y-1">{visible.map((entry, i) => <div key={entry.track.id} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-surface-container">
      <button onClick={() => play(i)} aria-label={`Воспроизвести ${entry.track.title}`} className="w-12 h-12 shrink-0 overflow-hidden rounded-xl bg-primary/15 text-primary flex items-center justify-center">{entry.track.thumbnail ? <img src={entry.track.thumbnail} alt="" className="w-full h-full object-cover" /> : <Play size={16} />}</button>
      <button onClick={() => play(i)} className="flex-1 text-left min-w-0"><p className="text-sm font-semibold truncate">{entry.track.title}</p><p className="text-xs text-on-surface-variant truncate">{entry.track.artist}</p></button>
      <span className="text-xs text-on-surface-variant">{(entry.bytes / 1024 / 1024).toFixed(1)} МБ</span>
      <button onClick={() => void remove(entry)} disabled={busy === entry.track.id} aria-label={`Удалить офлайн-копию ${entry.track.title}`} className="p-3 rounded-full hover:bg-error/15 text-on-surface-variant disabled:opacity-40"><Trash2 size={16} /></button>
    </div>)}</div> : <div className="py-16 text-center text-on-surface-variant"><Download size={32} className="mx-auto mb-4 opacity-50" /><p className="font-semibold">{query ? 'Сохранённых треков не найдено' : 'Музыка всегда с тобой'}</p><p className="text-sm mt-2">В меню трека выберите «Сохранить офлайн».</p></div>}
  </section>;
}
