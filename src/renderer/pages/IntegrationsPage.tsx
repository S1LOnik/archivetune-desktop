import React, { useEffect, useState } from 'react';
import {
  PlugZap,
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
    <div className="p-6 max-w-6xl mx-auto space-y-7">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-on-surface flex items-center gap-2.5">
            <PlugZap className="text-primary" size={26} />
            Интеграции аккаунтов и Матрица источников
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Привязка Spotify + YouTube Music + SoundCloud, приоритет Lossless-маршрутизации и импорт плейлистов
          </p>
        </div>
        <button
          onClick={() => void handleCheckLatencies()}
          className="px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold flex items-center gap-2"
        >
          <Activity size={14} className={checkingLatency ? 'animate-spin text-primary' : ''} />
          Проверить пинг серверов
        </button>
      </div>

      {/* Primary Trio: Spotify & YouTube Music first, SoundCloud secondary */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* SPOTIFY CARD */}
        <div className="p-5 rounded-3xl bg-surface-container border border-green-500/25 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-green-500/20 text-green-300 flex items-center justify-center font-black text-lg">
                SP
              </div>
              <div>
                <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
                  Spotify
                  {spotifyConnected ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 font-bold inline-flex items-center gap-1">
                      <CheckCircle2 size={11} /> Подключён
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant font-bold inline-flex items-center gap-1">
                      <XCircle size={11} /> Не подключён
                    </span>
                  )}
                </h2>
                <p className="text-xs text-on-surface-variant">
                  {spotifyConnected && spotifyUser
                    ? `${spotifyUser.displayName} (${spotifyUser.product || 'Web'})`
                    : 'BrowserWindow OAuth + sp_dc + Audio Features (BPM) + Canvas'}
                </p>
              </div>
            </div>
            {spotifyConnected ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncSpotifyLiked}
                  className="px-3 py-1.5 rounded-xl bg-green-500/20 text-green-200 hover:bg-green-500/30 text-xs font-bold"
                >
                  Синк лайков
                </button>
                <button
                  onClick={async () => {
                    await window.electronAPI.spotify.disconnect();
                    await refreshAllStatuses();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-red-500/15 text-red-300 text-xs font-semibold"
                >
                  Выйти
                </button>
              </div>
            ) : (
              <button
                onClick={handleSpotifyLogin}
                className="px-4 py-2 rounded-xl bg-green-500 text-black text-xs font-black hover:brightness-110 transition"
              >
                Войти в Spotify
              </button>
            )}
          </div>

          <div className="flex gap-2">
            <input
              value={manualSpDc}
              onChange={(e) => setManualSpDc(e.target.value)}
              placeholder="Или вставьте sp_dc / Bearer токен вручную..."
              className="flex-1 px-3 py-2 rounded-xl bg-surface-container-high text-xs text-on-surface outline-none border border-outline-variant/20 focus:border-green-400"
            />
            <button
              onClick={handleSpotifyManual}
              className="px-3.5 py-2 rounded-xl bg-surface-container-highest hover:bg-green-500/20 text-xs font-semibold"
            >
              Привязать
            </button>
          </div>
        </div>

        {/* YOUTUBE MUSIC CARD */}
        <div className="p-5 rounded-3xl bg-surface-container border border-red-500/25 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-red-500/20 text-red-300 flex items-center justify-center font-black text-lg">
                YT
              </div>
              <div>
                <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
                  YouTube / YTM
                  {ytmConnected ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 font-bold inline-flex items-center gap-1">
                      <CheckCircle2 size={11} /> SAPISIDHASH
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-container-highest text-on-surface-variant font-bold">
                      Гостевой режим
                    </span>
                  )}
                </h2>
                <p className="text-xs text-on-surface-variant">
                  {ytmConnected && ytmActiveAccount
                    ? `${ytmActiveAccount.name} ${ytmActiveAccount.channelHandle || ytmActiveAccount.email}`
                    : 'Google Cookie Auth + dataSyncId + Мульти-аккаунт + Двусторонние лайки'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {ytmConnected && (
                <>
                  <button
                    onClick={handleSyncYtmLiked}
                    className="px-3 py-1.5 rounded-xl bg-red-500/20 text-red-200 hover:bg-red-500/30 text-xs font-bold"
                  >
                    Синк YTM
                  </button>
                  <button
                    onClick={async () => {
                      await window.electronAPI.ytmAuth.logout();
                      await refreshAllStatuses();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-surface-container-highest text-xs font-semibold text-red-300"
                  >
                    Выйти
                  </button>
                </>
              )}
              <button
                onClick={handleYtmLogin}
                className="px-4 py-2 rounded-xl bg-red-500 text-white text-xs font-black hover:brightness-110 transition"
              >
                {ytmConnected ? '+ Аккаунт' : 'Войти через Google'}
              </button>
            </div>
          </div>

          {/* Saved YouTube Accounts Switcher */}
          {ytmSavedAccounts.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-on-surface-variant flex items-center gap-1">
                <Users size={12} /> Аккаунты:
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
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition ${
                      isActive
                        ? 'bg-red-500/20 border-red-400/50 text-red-200'
                        : 'bg-surface-container-high border-outline-variant/20 text-on-surface-variant'
                    }`}
                  >
                    {acc.name} {acc.hasDataSyncId ? '✓' : ''}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={manualYtCookie}
              onChange={(e) => setManualYtCookie(e.target.value)}
              placeholder="Или вставьте YouTube Cookie (с SAPISID)..."
              className="flex-1 px-3 py-2 rounded-xl bg-surface-container-high text-xs text-on-surface outline-none border border-outline-variant/20"
            />
            <button
              onClick={handleYtmManual}
              className="px-3.5 py-2 rounded-xl bg-surface-container-highest text-xs font-semibold"
            >
              Cookie
            </button>
          </div>
        </div>
      </div>

      {/* SoundCloud (Secondary) + Lossless Tokens (Tidal/Qobuz/Deezer) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* SOUNDCLOUD */}
        <div className="p-5 rounded-3xl bg-surface-container border border-orange-500/20 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-orange-500/20 text-orange-300 flex items-center justify-center font-black">
                SC
              </div>
              <div>
                <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                  SoundCloud <span className="text-[10px] text-on-surface-variant font-normal">(доп. источник)</span>
                </h3>
                <p className="text-xs text-on-surface-variant">
                  {scConnected && scUser ? `Профиль: ${scUser.username}` : 'OAuth WebView + авто-скрапер client_id'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  const r = await window.electronAPI.soundcloud.refreshClientId();
                  pushToast(r.ok ? `Client ID обновлён (${r.clientId?.slice(0, 8)}...)` : 'Ошибка client_id', 'info');
                }}
                className="p-2 rounded-xl bg-surface-container-high text-on-surface-variant hover:text-on-surface"
                title="Обновить client_id"
              >
                <RefreshCw size={13} />
              </button>
              {scConnected ? (
                <button
                  onClick={async () => {
                    await window.electronAPI.soundcloud.logout();
                    await refreshAllStatuses();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-red-500/15 text-red-300 text-xs font-semibold"
                >
                  Выйти
                </button>
              ) : (
                <button
                  onClick={handleScLogin}
                  className="px-3.5 py-1.5 rounded-xl bg-orange-500 text-black text-xs font-bold"
                >
                  Войти
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <input
              value={manualScToken}
              onChange={(e) => setManualScToken(e.target.value)}
              placeholder="Ручной OAuth токен SoundCloud..."
              className="flex-1 px-3 py-1.5 rounded-xl bg-surface-container-high text-xs text-on-surface outline-none"
            />
            <button onClick={handleScManual} className="px-3 py-1.5 rounded-xl bg-surface-container-highest text-xs font-semibold">
              OK
            </button>
          </div>
        </div>

        {/* TIDAL / QOBUZ / DEEZER HI-RES */}
        <div className="p-5 rounded-3xl bg-surface-container border border-cyan-500/20 space-y-3">
          <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
            <Sparkles size={16} className="text-cyan-300" /> Hi-Res и Lossless провайдеры (Tidal, Qobuz, Deezer)
          </h3>
          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <label className="space-y-1">
              <span className="text-on-surface-variant">Tidal Quality</span>
              <select
                value={tidalQuality}
                onChange={(e) => {
                  setTidalQuality(e.target.value);
                  void window.electronAPI.db.updateSettings({ tidalQuality: e.target.value as any });
                }}
                className="w-full px-2.5 py-1.5 rounded-xl bg-surface-container-high text-on-surface outline-none"
              >
                <option value="HI_RES_LOSSLESS">Hi-Res FLAC (24-bit)</option>
                <option value="LOSSLESS">CD Lossless (16/44.1)</option>
                <option value="HIGH">AAC 320 kbps</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-on-surface-variant">Qobuz Quality</span>
              <select
                value={qobuzQuality}
                onChange={(e) => {
                  setQobuzQuality(e.target.value);
                  void window.electronAPI.db.updateSettings({ qobuzQuality: e.target.value as any });
                }}
                className="w-full px-2.5 py-1.5 rounded-xl bg-surface-container-high text-on-surface outline-none"
              >
                <option value="HI_RES_192">Hi-Res 24/192</option>
                <option value="LOSSLESS">FLAC 16/44.1</option>
                <option value="MP3_320">MP3 320</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <input
              value={tidalToken}
              onChange={(e) => {
                setTidalToken(e.target.value);
                void window.electronAPI.db.updateSettings({ tidalToken: e.target.value });
              }}
              placeholder="Tidal Token (опц.)"
              className="px-2.5 py-1.5 rounded-xl bg-surface-container-high text-on-surface outline-none"
            />
            <input
              value={qobuzToken}
              onChange={(e) => {
                setQobuzToken(e.target.value);
                void window.electronAPI.db.updateSettings({ qobuzToken: e.target.value });
              }}
              placeholder="Qobuz Token (опц.)"
              className="px-2.5 py-1.5 rounded-xl bg-surface-container-high text-on-surface outline-none"
            />
            <input
              value={deezerArl}
              onChange={(e) => {
                setDeezerArl(e.target.value);
                void window.electronAPI.db.updateSettings({ deezerArl: e.target.value });
              }}
              placeholder="Deezer ARL (опц.)"
              className="px-2.5 py-1.5 rounded-xl bg-surface-container-high text-on-surface outline-none"
            />
          </div>
        </div>
      </div>

      {/* SMART ROUTING PRIORITY + LATENCY MONITOR */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="p-5 rounded-3xl bg-surface-container border border-outline-variant/25 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <Shield size={17} className="text-primary" /> Умное переключение и Приоритет
            </h2>
            <select
              value={preferredAudioSource}
              onChange={(e) => setPreferredAudioSource(e.target.value as any)}
              className="px-3 py-1.5 rounded-xl bg-surface-container-high text-xs font-semibold text-primary outline-none"
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
              className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                universalFallback ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              Universal Fallback {universalFallback ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
            <button
              onClick={() => setAutoUpgradeLossless(!autoUpgradeLossless)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                autoUpgradeLossless ? 'bg-emerald-500/25 text-emerald-200 border border-emerald-400/30' : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              Lossless Auto-Upgrade {autoUpgradeLossless ? 'ВКЛ' : 'ВЫКЛ'}
            </button>
          </div>

          <div className="space-y-1.5">
            {sourceOrder.map((src, idx) => {
              const enabled = enabledSources[src] ?? true;
              return (
                <div
                  key={src}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface-container-high/70 border border-outline-variant/15 text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-5 text-on-surface-variant font-mono">#{idx + 1}</span>
                    <button
                      onClick={() => toggleSourceEnabled(src, !enabled)}
                      className={`px-2 py-0.5 rounded font-bold uppercase ${
                        enabled ? 'bg-primary/20 text-primary' : 'bg-surface-container text-on-surface-variant line-through'
                      }`}
                    >
                      {src}
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => moveSource(idx, -1)}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-surface-container-highest disabled:opacity-30"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() => moveSource(idx, 1)}
                      disabled={idx === sourceOrder.length - 1}
                      className="p-1 rounded hover:bg-surface-container-highest disabled:opacity-30"
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* LATENCY MONITOR + PLAYLIST URL/FILE IMPORTER */}
        <div className="space-y-5">
          <section className="p-5 rounded-3xl bg-surface-container border border-outline-variant/25 space-y-3">
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <Activity size={17} className="text-primary" /> Latency Server Monitor
            </h2>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {latencies.map((item) => (
                <div
                  key={item.source}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface-container-high/70"
                >
                  <span className="font-semibold text-on-surface">{item.name}</span>
                  <span
                    className={`font-mono font-bold ${
                      item.status === 'healthy'
                        ? 'text-emerald-300'
                        : item.status === 'degraded'
                        ? 'text-amber-300'
                        : 'text-red-400'
                    }`}
                  >
                    {item.latencyMs !== null ? `${item.latencyMs}ms` : 'Offline'}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="p-5 rounded-3xl bg-surface-container border border-outline-variant/25 space-y-3">
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <Link2 size={17} className="text-primary" /> Импорт плейлистов (URL / M3U8 / JSON)
            </h2>
            <p className="text-xs text-on-surface-variant">
              Вставьте ссылку на плейлист Spotify, YouTube или Deezer, либо импортируйте файл `.m3u8`/`.json`.
            </p>
            <div className="flex gap-2">
              <input
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                placeholder="https://open.spotify.com/playlist/... или youtube.com/playlist?list=..."
                className="flex-1 px-3 py-2 rounded-xl bg-surface-container-high text-xs text-on-surface outline-none"
              />
              <button
                onClick={handleImportUrl}
                disabled={importing}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold disabled:opacity-50"
              >
                {importing ? 'Импорт...' : 'Импорт URL'}
              </button>
            </div>
            <button
              onClick={handleImportFile}
              className="px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-xs font-semibold inline-flex items-center gap-2"
            >
              <FileUp size={14} /> Импорт из .M3U8 / .JSON файла
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
