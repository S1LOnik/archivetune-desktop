import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Link2,
  FileUp,
  Activity,
  Shield,
  Users,
  Sparkles,
} from 'lucide-react';
import { useAccountsStore, usePlayerStore, useUIStore } from '../store';
import type { AudioSourceId, ProviderLatencyInfo } from '../types/electron';
import SpotifyNativeStatus from '../components/SpotifyNativeStatus';

export default function IntegrationsPage() {
  const {
    spotifyConnected,
    spotifyUser,
    ytmConnected,
    ytmActiveAccount,
    ytmSavedAccounts,
    scConnected,
    scUser,
    refreshAllStatuses,
  } = useAccountsStore();
  const {
    preferredAudioSource,
    sourceOrder,
    enabledSources,
    universalFallback,
    autoUpgradeLossless,
    setPreferredAudioSource,
    setSourceOrder,
    toggleSourceEnabled,
    setUniversalFallback,
    setAutoUpgradeLossless,
    upsertLikedSongs,
  } = usePlayerStore();
  const { pushToast } = useUIStore();

  const [latencies, setLatencies] = useState<ProviderLatencyInfo[]>([]);
  const [checkingLatency, setCheckingLatency] = useState(false);

  const [manualSpDc, setManualSpDc] = useState('');
  const [manualYtCookie, setManualYtCookie] = useState('');
  const [manualScToken, setManualScToken] = useState('');

  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);

  // Extended lossless tokens & qualities
  const [tidalQuality, setTidalQuality] = useState('LOSSLESS');
  const [qobuzQuality, setQobuzQuality] = useState('LOSSLESS');
  const [deezerArl, setDeezerArl] = useState('');
  const [tidalToken, setTidalToken] = useState('');
  const [qobuzToken, setQobuzToken] = useState('');

  useEffect(() => {
    void refreshAllStatuses();
    void handleCheckLatencies();
    window.electronAPI?.db?.getInitialState?.().then((db) => {
      if (db?.settings) {
        setTidalQuality(db.settings.tidalQuality || 'LOSSLESS');
        setQobuzQuality(db.settings.qobuzQuality || 'LOSSLESS');
        setDeezerArl(db.settings.deezerArl || '');
        setTidalToken(db.settings.tidalToken || '');
        setQobuzToken(db.settings.qobuzToken || '');
      }
    });
  }, []);

  const handleCheckLatencies = async () => {
    setCheckingLatency(true);
    try {
      const res = await window.electronAPI?.providers?.checkLatencies?.();
      if (Array.isArray(res)) setLatencies(res);
    } finally {
      setCheckingLatency(false);
    }
  };

  // Spotify handlers
  const handleSpotifyLogin = async () => {
    const res = await window.electronAPI?.spotify?.login();
    if (res?.ok) {
      await refreshAllStatuses();
      pushToast(`Spotify подключён: ${res.user?.displayName}`, 'lossless');
    } else if (res?.error) {
      pushToast(res.error, 'error');
    }
  };

  const handleSpotifyManual = async () => {
    if (!manualSpDc.trim()) return;
    const res = await window.electronAPI?.spotify?.connectManual(manualSpDc);
    if (res?.ok) {
      setManualSpDc('');
      await refreshAllStatuses();
      pushToast(`Spotify подключён: ${res.user?.displayName}`, 'lossless');
    } else {
      pushToast(res?.error || 'Неверный токен / sp_dc', 'error');
    }
  };

  const handleSyncSpotifyLiked = async () => {
    pushToast('Синхронизация Любимых треков Spotify...', 'info');
    const tracks = await window.electronAPI?.spotify?.getLikedSongs(50, 0);
    if (tracks?.length) {
      upsertLikedSongs(tracks);
      pushToast(`Синхронизировано ${tracks.length} треков из Spotify!`, 'lossless');
    }
  };

  // YouTube Music handlers
  const handleYtmLogin = async () => {
    const res = await window.electronAPI?.ytmAuth?.login();
    if (res?.ok) {
      await refreshAllStatuses();
      pushToast(`YouTube Music подключён: ${res.account?.name}`, 'lossless');
    } else if (res?.error) {
      pushToast(res.error, 'error');
    }
  };

  const handleYtmManual = async () => {
    if (!manualYtCookie.trim()) return;
    const res = await window.electronAPI?.ytmAuth?.connectManualCookie(manualYtCookie);
    if (res?.ok) {
      setManualYtCookie('');
      await refreshAllStatuses();
      pushToast(`YouTube Music подключён: ${res.account?.name}`, 'lossless');
    } else {
      pushToast(res?.error || 'Невалидные cookies YouTube', 'error');
    }
  };

  const handleSyncYtmLiked = async () => {
    pushToast('Синхронизация YouTube Music Liked Songs...', 'info');
    const tracks = await window.electronAPI?.ytmAuth?.getLikedSongs(true);
    if (tracks?.length) {
      upsertLikedSongs(tracks);
      pushToast(`Импортировано ${tracks.length} лайков из YouTube Music!`, 'lossless');
    } else {
      pushToast('Лайки YTM не найдены или аккаунт не авторизован.', 'info');
    }
  };

  // SoundCloud handlers
  const handleScLogin = async () => {
    const res = await window.electronAPI?.soundcloud?.login();
    if (res?.ok) {
      await refreshAllStatuses();
      pushToast(`SoundCloud подключён: ${res.user?.username}`, 'lossless');
    } else if (res?.error) {
      pushToast(res.error, 'error');
    }
  };

  const handleScManual = async () => {
    if (!manualScToken.trim()) return;
    const res = await window.electronAPI?.soundcloud?.connectManual(manualScToken);
    if (res?.ok) {
      setManualScToken('');
      await refreshAllStatuses();
      pushToast(`SoundCloud подключён: ${res.user?.username}`, 'lossless');
    } else {
      pushToast(res?.error || 'Неверный SoundCloud oauth_token', 'error');
    }
  };

  // Source Priority Move
  const moveSource = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= sourceOrder.length) return;
    const next = [...sourceOrder];
    [next[idx], next[target]] = [next[target], next[idx]];
    setSourceOrder(next);
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const res = await window.electronAPI?.playlists?.importFromUrl(importUrl.trim());
      if (res?.ok && res.playlist) {
        setImportUrl('');
        pushToast(`Импортирован "${res.playlist.name}" (${res.playlist.trackCount} треков)`, 'lossless');
      } else {
        pushToast(res?.error || 'Ошибка импорта по ссылке', 'error');
      }
    } finally {
      setImporting(false);
    }
  };

  const handleImportFile = async () => {
    const res = await window.electronAPI?.playlists?.importFromFile();
    if (res?.ok && res.playlist) {
      pushToast(`Импортирован файл "${res.playlist.name}" (${res.playlist.trackCount} треков)`, 'lossless');
    } else if (res?.error) {
      pushToast(res.error, 'error');
    }
  };

  return (
    <div className="screen screen-settings">
      <header className="screen-header">
        <h1>Интеграции</h1>
        <button
          onClick={() => void handleCheckLatencies()}
          className="px-4 py-2.5 rounded-2xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold text-on-surface flex items-center gap-2 transition-all shadow-sm active:scale-98"
        >
          <Activity size={15} className={checkingLatency ? 'animate-spin text-primary' : 'text-primary'} />
          <span>Проверить задержку</span>
        </button>
      </header>

      {/* Primary Trio: Spotify & YouTube Music */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SPOTIFY CARD */}
        <div className="p-6 rounded-3xl bg-surface-container/70 backdrop-blur-xl shadow-md space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-green-500/25 to-emerald-600/15 text-green-400 flex items-center justify-center font-black text-lg shadow-sm">
                  SP
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-on-surface flex items-center gap-2.5">
                    <span>Spotify</span>
                    {spotifyConnected ? (
                      <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold inline-flex items-center gap-1">
                        <CheckCircle2 size={11} /> Подключён
                      </span>
                    ) : (
                      <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant font-bold inline-flex items-center gap-1">
                        <XCircle size={11} /> Не подключён
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {spotifyConnected && spotifyUser
                      ? `${spotifyUser.displayName} (${spotifyUser.product || 'WebPlayer'})`
                      : 'OAuth WebPlayer + sp_dc + BPM Features + Canvas'}
                  </p>
                </div>
              </div>

              {spotifyConnected ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSyncSpotifyLiked}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 text-xs font-bold transition-all"
                  >
                    Синк лайков
                  </button>
                  <button
                    onClick={async () => {
                      await window.electronAPI.spotify.disconnect();
                      await refreshAllStatuses();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-surface-container-highest hover:bg-red-500/20 text-red-300 text-xs font-semibold transition-all"
                  >
                    Выйти
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleSpotifyLogin}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black transition-all shadow-md active:scale-98"
                >
                  Войти в Spotify
                </button>
              )}
            </div>

            {/* Native Spotify Vorbis Section */}
            <SpotifyNativeStatus />
          </div>

          <div className="flex gap-2 pt-1">
            <input
              value={manualSpDc}
              onChange={(e) => setManualSpDc(e.target.value)}
              placeholder="Или вставьте sp_dc / Bearer токен вручную..."
              className="flex-1 px-3.5 py-2.5 rounded-2xl bg-surface-container-high/80 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:bg-surface-container-highest transition-all"
            />
            <button
              onClick={handleSpotifyManual}
              className="px-4 py-2.5 rounded-2xl bg-surface-container-highest hover:bg-emerald-500/20 text-xs font-semibold text-on-surface transition-all"
            >
              Привязать
            </button>
          </div>
        </div>

        {/* YOUTUBE MUSIC CARD */}
        <div className="p-6 rounded-3xl bg-surface-container/70 backdrop-blur-xl shadow-md space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500/25 to-rose-600/15 text-red-400 flex items-center justify-center font-black text-lg shadow-sm">
                  YT
                </div>
                <div>
                  <h2 className="text-base font-extrabold text-on-surface flex items-center gap-2.5">
                    <span>YouTube Music</span>
                    {ytmConnected ? (
                      <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-300 font-bold inline-flex items-center gap-1">
                        <CheckCircle2 size={11} /> SAPISID
                      </span>
                    ) : (
                      <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant font-bold">
                        Гостевой режим
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {ytmConnected && ytmActiveAccount
                      ? `${ytmActiveAccount.name} (${ytmActiveAccount.channelHandle || ytmActiveAccount.email || 'Основной'})`
                      : 'Google Cookie Auth + dataSyncId + Мульти-аккаунты + Двусторонние лайки'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {ytmConnected && (
                  <>
                    <button
                      onClick={handleSyncYtmLiked}
                      className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-bold transition-all"
                    >
                      Синк YTM
                    </button>
                    <button
                      onClick={async () => {
                        await window.electronAPI.ytmAuth.logout();
                        await refreshAllStatuses();
                      }}
                      className="px-3 py-1.5 rounded-xl bg-surface-container-highest hover:bg-red-500/20 text-red-300 text-xs font-semibold transition-all"
                    >
                      Выйти
                    </button>
                  </>
                )}
                <button
                  onClick={handleYtmLogin}
                  className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white text-xs font-black transition-all shadow-md active:scale-98"
                >
                  {ytmConnected ? '+ Аккаунт' : 'Войти в Google'}
                </button>
              </div>
            </div>

            {/* Saved YouTube Accounts Switcher */}
            {ytmSavedAccounts.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap p-3 rounded-2xl bg-surface-container-high/60">
                <span className="text-[11px] font-semibold text-on-surface-variant flex items-center gap-1.5">
                  <Users size={13} /> Аккаунты:
                </span>
                {ytmSavedAccounts.map((acc) => {
                  const isActive = ytmActiveAccount?.id === acc.id;
                  return (
                    <button
                      key={acc.id}
                      onClick={async () => {
                        await window.electronAPI.ytmAuth.switchAccount(acc.id);
                        await refreshAllStatuses();
                        pushToast(`Активен канал: ${acc.name}`, 'info');
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all shadow-sm ${
                        isActive
                          ? 'bg-red-500/20 text-red-200'
                          : 'bg-surface-container-highest text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {acc.name} {acc.hasDataSyncId ? '✓' : ''}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <input
              value={manualYtCookie}
              onChange={(e) => setManualYtCookie(e.target.value)}
              placeholder="Или вставьте YouTube Cookie (с SAPISID)..."
              className="flex-1 px-3.5 py-2.5 rounded-2xl bg-surface-container-high/80 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:bg-surface-container-highest transition-all"
            />
            <button
              onClick={handleYtmManual}
              className="px-4 py-2.5 rounded-2xl bg-surface-container-highest hover:bg-red-500/20 text-xs font-semibold text-on-surface transition-all"
            >
              Cookie
            </button>
          </div>
        </div>
      </div>

      {/* SoundCloud & Lossless Providers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* SOUNDCLOUD */}
        <div className="p-6 rounded-3xl bg-surface-container/70 backdrop-blur-xl shadow-md space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-amber-500/25 to-orange-600/15 text-amber-400 flex items-center justify-center font-black text-sm shadow-sm">
                  SC
                </div>
                <div>
                  <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                    <span>SoundCloud</span>
                    <span className="text-[10px] text-on-surface-variant font-normal">(доп. источник)</span>
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    {scConnected && scUser ? `Профиль: ${scUser.username}` : 'OAuth WebView + авто-ротация client_id'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    const r = await window.electronAPI.soundcloud.refreshClientId();
                    pushToast(r.ok ? `Client ID обновлён (${r.clientId?.slice(0, 8)}...)` : 'Ошибка client_id', 'info');
                  }}
                  className="p-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all"
                  title="Обновить client_id"
                >
                  <RefreshCw size={14} />
                </button>
                {scConnected ? (
                  <button
                    onClick={async () => {
                      await window.electronAPI.soundcloud.logout();
                      await refreshAllStatuses();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-surface-container-highest hover:bg-red-500/20 text-red-300 text-xs font-semibold transition-all"
                  >
                    Выйти
                  </button>
                ) : (
                  <button
                    onClick={handleScLogin}
                    className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-all shadow-md"
                  >
                    Войти
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              value={manualScToken}
              onChange={(e) => setManualScToken(e.target.value)}
              placeholder="Ручной OAuth токен SoundCloud..."
              className="flex-1 px-3.5 py-2.5 rounded-2xl bg-surface-container-high/80 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:bg-surface-container-highest transition-all"
            />
            <button
              onClick={handleScManual}
              className="px-4 py-2.5 rounded-2xl bg-surface-container-highest hover:bg-amber-500/20 text-xs font-semibold text-on-surface transition-all"
            >
              OK
            </button>
          </div>
        </div>

        {/* TIDAL / QOBUZ / DEEZER HI-RES */}
        <div className="p-6 rounded-3xl bg-surface-container/70 backdrop-blur-xl shadow-md space-y-4">
          <h3 className="text-sm font-bold text-on-surface flex items-center gap-2.5">
            <Sparkles size={17} className="text-cyan-400" />
            <span>Hi-Res и Lossless провайдеры (Tidal, Qobuz, Deezer)</span>
          </h3>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="space-y-1.5">
              <span className="text-on-surface-variant font-medium">Tidal Качество</span>
              <select
                value={tidalQuality}
                onChange={(e) => {
                  setTidalQuality(e.target.value);
                  void window.electronAPI.db.updateSettings({ tidalQuality: e.target.value as any });
                }}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface font-semibold focus:bg-surface-container-highest transition-all cursor-pointer"
              >
                <option value="HI_RES_LOSSLESS">Hi-Res FLAC (24-bit)</option>
                <option value="LOSSLESS">CD Lossless (16/44.1)</option>
                <option value="HIGH">AAC 320 kbps</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-on-surface-variant font-medium">Qobuz Качество</span>
              <select
                value={qobuzQuality}
                onChange={(e) => {
                  setQobuzQuality(e.target.value);
                  void window.electronAPI.db.updateSettings({ qobuzQuality: e.target.value as any });
                }}
                className="w-full px-3 py-2 rounded-xl bg-surface-container-high text-on-surface font-semibold focus:bg-surface-container-highest transition-all cursor-pointer"
              >
                <option value="HI_RES_192">Hi-Res 24/192</option>
                <option value="LOSSLESS">FLAC 16/44.1</option>
                <option value="MP3_320">MP3 320 kbps</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <input
              value={tidalToken}
              onChange={(e) => {
                setTidalToken(e.target.value);
                void window.electronAPI.db.updateSettings({ tidalToken: e.target.value });
              }}
              placeholder="Tidal Token"
              className="px-3 py-2 rounded-xl bg-surface-container-high text-on-surface placeholder:text-on-surface-variant/40 focus:bg-surface-container-highest transition-all"
            />
            <input
              value={qobuzToken}
              onChange={(e) => {
                setQobuzToken(e.target.value);
                void window.electronAPI.db.updateSettings({ qobuzToken: e.target.value });
              }}
              placeholder="Qobuz Token"
              className="px-3 py-2 rounded-xl bg-surface-container-high text-on-surface placeholder:text-on-surface-variant/40 focus:bg-surface-container-highest transition-all"
            />
            <input
              value={deezerArl}
              onChange={(e) => {
                setDeezerArl(e.target.value);
                void window.electronAPI.db.updateSettings({ deezerArl: e.target.value });
              }}
              placeholder="Deezer ARL"
              className="px-3 py-2 rounded-xl bg-surface-container-high text-on-surface placeholder:text-on-surface-variant/40 focus:bg-surface-container-highest transition-all"
            />
          </div>
        </div>
      </div>

      {/* SMART ROUTING PRIORITY + LATENCY MONITOR */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PRIORITY ROUTING */}
        <section className="p-6 rounded-3xl bg-surface-container/70 backdrop-blur-xl shadow-md space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-on-surface flex items-center gap-2.5">
              <Shield size={18} className="text-primary" />
              <span>Умное переключение и Приоритет</span>
            </h2>
            <select
              value={preferredAudioSource}
              onChange={(e) => setPreferredAudioSource(e.target.value as any)}
              className="px-3 py-1.5 rounded-xl bg-surface-container-high text-xs font-bold text-primary focus:bg-surface-container-highest cursor-pointer transition-all"
            >
              <option value="auto">Auto (по приоритету)</option>
              {sourceOrder.map((s) => (
                <option key={s} value={s}>
                  Предпочитать: {s.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setUniversalFallback(!universalFallback)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm ${
                universalFallback
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Universal Fallback: {universalFallback ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
            <button
              onClick={() => setAutoUpgradeLossless(!autoUpgradeLossless)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm ${
                autoUpgradeLossless
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Lossless Auto-Upgrade: {autoUpgradeLossless ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
          </div>

          <div className="space-y-1.5">
            {sourceOrder.map((src, idx) => {
              const enabled = enabledSources[src] ?? true;
              return (
                <div
                  key={src}
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-surface-container-high/60 hover:bg-surface-container-high text-xs transition-all shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-6 text-on-surface-variant font-mono font-bold">#{idx + 1}</span>
                    <button
                      onClick={() => toggleSourceEnabled(src, !enabled)}
                      className={`px-2.5 py-1 rounded-xl font-bold uppercase tracking-wider text-[11px] transition-all ${
                        enabled
                          ? 'bg-primary/20 text-primary'
                          : 'bg-surface-container text-on-surface-variant/40 line-through'
                      }`}
                    >
                      {src}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveSource(idx, -1)}
                      disabled={idx === 0}
                      className="p-1.5 rounded-xl hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface disabled:opacity-20 transition-all"
                      title="Выше в приоритете"
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      onClick={() => moveSource(idx, 1)}
                      disabled={idx === sourceOrder.length - 1}
                      className="p-1.5 rounded-xl hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface disabled:opacity-20 transition-all"
                      title="Ниже в приоритете"
                    >
                      <ArrowDown size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* LATENCY MONITOR + PLAYLIST IMPORTER */}
        <div className="space-y-6">
          <section className="p-6 rounded-3xl bg-surface-container/70 backdrop-blur-xl shadow-md space-y-4">
            <h2 className="text-base font-extrabold text-on-surface flex items-center gap-2.5">
              <Activity size={18} className="text-primary" />
              <span>Задержка серверов</span>
            </h2>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              {latencies.map((item) => (
                <div
                  key={item.source}
                  className="flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-surface-container-high/60 shadow-sm"
                >
                  <span className="font-semibold text-on-surface">{item.name}</span>
                  <span
                    className={`font-mono font-bold flex items-center gap-1.5 ${
                      item.status === 'healthy'
                        ? 'text-emerald-300'
                        : item.status === 'degraded'
                        ? 'text-amber-300'
                        : 'text-red-400'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        item.status === 'healthy'
                          ? 'bg-emerald-400'
                          : item.status === 'degraded'
                          ? 'bg-amber-400'
                          : 'bg-red-400'
                      }`}
                    />
                    {item.latencyMs !== null ? `${item.latencyMs}ms` : 'Offline'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="p-6 rounded-3xl bg-surface-container/70 backdrop-blur-xl shadow-md space-y-4">
            <h2 className="text-base font-extrabold text-on-surface flex items-center gap-2.5">
              <Link2 size={18} className="text-primary" />
              <span>Импорт плейлистов (URL / M3U8 / JSON)</span>
            </h2>
            <p className="text-xs text-on-surface-variant">
              Вставьте ссылку на Spotify, YouTube Music или Deezer, либо импортируйте готовый файл.
            </p>
            <div className="flex gap-2">
              <input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://open.spotify.com/playlist/... или youtube.com/playlist?list=..."
                className="flex-1 px-3.5 py-2.5 rounded-2xl bg-surface-container-high/80 text-xs text-on-surface placeholder:text-on-surface-variant/50 focus:bg-surface-container-highest transition-all"
              />
              <button
                onClick={handleImportUrl}
                disabled={importing}
                className="px-4 py-2.5 rounded-2xl bg-primary hover:bg-rose-400 text-on-primary text-xs font-bold transition-all disabled:opacity-50 shadow-md active:scale-98"
              >
                {importing ? 'Импорт...' : 'Импорт URL'}
              </button>
            </div>
            <button
              onClick={handleImportFile}
              className="px-4 py-2.5 rounded-2xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold text-on-surface inline-flex items-center gap-2 transition-all shadow-sm"
            >
              <FileUp size={15} /> Импорт из .M3U8 / .JSON файла
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
