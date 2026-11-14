import React, { useEffect, useState } from 'react';
import { HardDrive, Trash2 } from 'lucide-react';
export default function CacheSettings() {
  const [info, setInfo] = useState<{ bytes: number; count: number; limitMB: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { window.electronAPI.playbackCache.info().then(setInfo).catch(() => setError('Кэш недоступен')); }, []);
  const change = async (action: () => Promise<NonNullable<typeof info>>) => {
    setBusy(true); setError('');
    try { setInfo(await action()); } catch { setError('Не удалось обновить кэш'); } finally { setBusy(false); }
  };
  return <section className="bg-surface-container rounded-2xl p-5 space-y-4">
    <div className="flex items-center gap-3"><HardDrive size={22} className="text-primary" /><div><h2 className="font-bold">Кэш прослушивания</h2><p className="text-xs text-on-surface-variant mt-1">Повторные запуски с устройства. Старые записи очищаются автоматически.</p></div></div>
    <div className="flex flex-wrap items-center gap-4">
      <label className="text-sm flex items-center gap-3">Размер кэша
        <select disabled={busy || !info} value={info?.limitMB ?? 512} onChange={e => void change(() => window.electronAPI.playbackCache.configure(Number(e.target.value)))} className="p-2 rounded-lg bg-surface-container-high text-on-surface">
          {[0,128,256,512,1024,2048].map(n => <option key={n} value={n}>{n ? `${n} МБ` : 'Выключен'}</option>)}
        </select>
      </label>
      <span className="text-xs text-on-surface-variant">{info ? `${(info.bytes / 1024 / 1024).toFixed(1)} МБ · ${info.count} треков` : 'Загрузка…'}</span>
      <button disabled={busy || !info?.count} onClick={() => void change(() => window.electronAPI.playbackCache.clear())} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-container-high text-sm disabled:opacity-40"><Trash2 size={15} /> Очистить кэш</button>
    </div>
    <p className="text-xs text-on-surface-variant">Скачивание для кэша идёт в фоне и использует интернет. Треки, сохранённые через «Сохранить офлайн», хранятся отдельно.</p>
    {error && <p role="alert" className="text-error text-sm">{error}</p>}
  </section>;
}
