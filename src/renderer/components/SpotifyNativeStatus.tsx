import React, { useEffect, useState } from 'react';
import { Radio, CheckCircle2, AlertCircle, RefreshCw, Zap } from 'lucide-react';

export default function SpotifyNativeStatus() {
  const [state, setState] = useState<{
    enabled: boolean;
    connected: boolean;
    lastError: string;
    bundled: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      const s = await window.electronAPI.spotify.nativeStatus();
      setState(s);
    } catch {
      setError('Статус нативного движка недоступен');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleConnect = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.spotify.nativeConnect();
      if (!result.ok) {
        setError(result.error || 'Не удалось активировать нативный аудиопоток');
      }
      await refresh();
    } catch (e: any) {
      setError(e.message || 'Ошибка проверки нативного соединения');
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    setBusy(true);
    setError('');
    try {
      await window.electronAPI.spotify.nativeDisable();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const isEnabled = state?.enabled ?? false;

  return (
    <div className="p-4 rounded-2xl bg-surface-container-high/60 backdrop-blur-md space-y-3 transition-all">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
            <Radio size={16} />
          </div>
          <div>
            <h4 className="text-xs font-bold text-on-surface flex items-center gap-2">
              Нативный Vorbis-движок (Librespot)
              {isEnabled ? (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold inline-flex items-center gap-1">
                  <CheckCircle2 size={10} /> Активен
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant font-bold inline-flex items-center gap-1">
                  Выключен
                </span>
              )}
            </h4>
            <p className="text-[11px] text-on-surface-variant">
              {isEnabled
                ? 'Прямое воспроизведение OGG Vorbis из Spotify CDN с автоматическим YouTube Fallback.'
                : 'Прямой аудиопоток через Librespot без внешних перекодировок.'}
            </p>
          </div>
        </div>

        <button
          disabled={busy || !state?.bundled}
          onClick={isEnabled ? handleDisable : handleConnect}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50 ${
            isEnabled
              ? 'bg-surface-container-highest hover:bg-surface-container-high text-on-surface'
              : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300'
          }`}
        >
          {busy ? (
            <>
              <RefreshCw size={12} className="animate-spin" />
              <span>Проверка...</span>
            </>
          ) : isEnabled ? (
            <span>Отключить</span>
          ) : (
            <>
              <Zap size={12} />
              <span>Проверить и включить</span>
            </>
          )}
        </button>
      </div>

      {(error || state?.lastError) && (
        <div className="p-2.5 rounded-xl bg-red-500/10 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle size={14} className="shrink-0" />
          <span>{error || state?.lastError}</span>
        </div>
      )}
    </div>
  );
}
