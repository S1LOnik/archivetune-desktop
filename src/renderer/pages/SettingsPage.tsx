import { useShallow } from 'zustand/react/shallow';
import CacheSettings from '../components/CacheSettings';
import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { INTERFACE_MOTION_PRESETS, useInterfaceMotion } from '../lib/useInterfaceMotion';
import {
  Palette,
  Radio,
  Disc3,
  Info,
  ExternalLink,
  Sliders,
  Sparkles,
  Monitor,
  Shield,
  Volume2,
  Download,
  HardDriveDownload,
  Activity,
  PlugZap,
  Check,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  useUIStore,
  usePlayerStore,
  useAccountsStore,
  PlayerStyleId,
  AutomixMode,
  AudioSourceId,
} from '../store';
import { usePlayer } from '../lib/usePlayer';

const EQ_LABELS = ['31Hz', '62Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];
const EQ_PRESET_MAP: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Harman Target': [4, 3.5, 2, 0, -1, 0, 2, 3.5, 3, 2],
  'Bass Boost': [6, 5, 4, 2, 0, 0, 0, 1, 2, 2],
  Vocal: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Electronic: [5, 4, 1, 0, -2, 1, 1, 3, 4, 5],
  Rock: [4.5, 3, 1.5, -1, -1.5, 1, 3, 4, 4.5, 4],
  Acoustic: [3, 3, 2, 1, 2, 2, 3, 3, 2, 2],
};

const SEED_COLORS = [
  { name: 'Lavender', hex: '#cbb9f5' },
  { name: 'Sakura Pink', hex: '#f0b8c6' },
  { name: 'Ocean Cyan', hex: '#a6e3e9' },
  { name: 'Mint Green', hex: '#a8e6cf' },
  { name: 'Amber Gold', hex: '#ffd3b6' },
  { name: 'Ruby Red', hex: '#ffaaa5' },
  { name: 'Violet Dark', hex: '#a29bfe' },
  { name: 'Sky Blue', hex: '#74b9ff' },
];

const PLAYER_STYLES: Array<{ id: PlayerStyleId; name: string; desc: string }> = [
  { id: 'flamingo', name: 'Flamingo (Apple Music)', desc: 'Сплит-лейаут, динамическая обложка и свечение караоке' },
  { id: 'v8_immersive', name: 'V8 Immersive Extended', desc: 'Полноэкранный Motion Canvas и матовый док' },
  { id: 'v10_expressive', name: 'V10 Expressive', desc: 'Центрированный M3 Expressive дизайн' },
  { id: 'bitchord', name: 'BitChord', desc: 'Контрастный минималистичный плеер' },
  { id: 'simpmusic', name: 'SimpMusic', desc: 'Карточный интерфейс с синхронными текстами' },
  { id: 'spatialflow', name: 'SpatialFlow', desc: '3D-объёмная обложка и амбиент-подсветка' },
  { id: 'tiktok', name: 'TikTok Vertical', desc: 'Вертикальный полноэкранный поток' },
  { id: 'classic', name: 'Classic ArchiveTune', desc: 'Классический стиль ArchiveTune' },
];

const AUTOMIX_MODES: Array<{ id: AutomixMode; label: string; desc: string }> = [
  { id: 'auto', label: 'Smart Auto', desc: 'Анализ BPM/Intro-Outro (подбор перехода автоматически)' },
  { id: 'dj_blend', label: 'DJ Equal-Power + Filter', desc: 'Плавный кроссфейд с низкочастотным фильтром' },
  { id: 'filter_ride', label: 'Filter Ride', desc: 'Мягкий срез басов уходящего трека' },
  { id: 'equal_power', label: 'Equal-Power Fade', desc: 'Равномерный S-curve кроссфейд' },
  { id: 'gapless', label: 'Pure Gapless', desc: 'Без наложения, нулевой зазор' },
];

const SPONSORBLOCK_CATEGORIES = [
  { id: 'sponsor', label: 'Спонсоры' },
  { id: 'intro', label: 'Интро / Заставки' },
  { id: 'outro', label: 'Аутро / Титры' },
  { id: 'music_offtopic', label: 'Немузыкальные вставки' },
  { id: 'selfpromo', label: 'Самореклама' },
  { id: 'interaction', label: 'Призывы подписаться' },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { reducedMotion, presetId, panelTransition } = useInterfaceMotion();
  const [previewAtEnd, setPreviewAtEnd] = useState(false);
  const {
    theme,
    setTheme,
    seedColor,
    setSeedColor,
    dynamicColorFromArt,
    setDynamicColorFromArt,
    uiScale,
    setUiScale,
    playerStyle,
    setPlayerStyle,
    ambientBackgroundBlur,
    reduceInterfaceMotion,
    compactTrackRows,
    glassEffect,
    setAppearance,
    visualizerEnabled,
    visualizerStyle,
    setVisualizer,
    closeToTray,
    mprisEnabled,
    discordRpc,
    localApiEnabled,
    hardwareAcceleration,
    lastfmApiKey,
    lastfmSecret,
    lastfmSessionKey,
    listenBrainzEnabled,
    listenBrainzToken,
    showSmartSwitchToasts,
    downloadFormat,
    embedMetadataAndLyrics,
    setDesktopSetting,
    pushToast,
  } = useUIStore();

  const {
    normalization,
    audioCompressor,
    exponentialVolume,
    pitchSemitones,
    bassBoost,
    stereoWidener,
    silenceSkip,
    audioDevice,
    speed,
    crossfade,
    smartDjAutomix,
    autoRadioOnQueueEnd,
    prebufferNextTrack,
    automixMode,
    gaplessAlbum,
    preferredAudioSource,
    enabledSources,
    universalFallback,
    autoUpgradeLossless,
    eqEnabled,
    eqPreset,
    eqBands,
    canvasEnabled,
    lyricsOffset,
    lyricsFontSize,
    lyricsWordByWord,
    lyricsRomanize,
    lyricsTranslate,
    lyricsTranslateLang,
    sponsorBlockEnabled,
    sponsorBlockCategories,
    aiContentFilter,
    setDspOption,
    setCrossfade,
    setSmartDjAutomix,
    setAutomixMode,
    setGaplessAlbum,
    setEqualizerState,
    setPreferredAudioSource,
    toggleSourceEnabled,
    setUniversalFallback,
    setAutoUpgradeLossless,
    setCanvasEnabled,
    setLyricsSettings,
  } = usePlayerStore(useShallow((state) => ({
    normalization: state.normalization,
    audioCompressor: state.audioCompressor,
    exponentialVolume: state.exponentialVolume,
    pitchSemitones: state.pitchSemitones,
    bassBoost: state.bassBoost,
    stereoWidener: state.stereoWidener,
    silenceSkip: state.silenceSkip,
    audioDevice: state.audioDevice,
    speed: state.speed,
    crossfade: state.crossfade,
    smartDjAutomix: state.smartDjAutomix,
    autoRadioOnQueueEnd: state.autoRadioOnQueueEnd,
    prebufferNextTrack: state.prebufferNextTrack,
    automixMode: state.automixMode,
    gaplessAlbum: state.gaplessAlbum,
    preferredAudioSource: state.preferredAudioSource,
    enabledSources: state.enabledSources,
    universalFallback: state.universalFallback,
    autoUpgradeLossless: state.autoUpgradeLossless,
    eqEnabled: state.eqEnabled,
    eqPreset: state.eqPreset,
    eqBands: state.eqBands,
    canvasEnabled: state.canvasEnabled,
    lyricsOffset: state.lyricsOffset,
    lyricsFontSize: state.lyricsFontSize,
    lyricsWordByWord: state.lyricsWordByWord,
    lyricsRomanize: state.lyricsRomanize,
    lyricsTranslate: state.lyricsTranslate,
    lyricsTranslateLang: state.lyricsTranslateLang,
    sponsorBlockEnabled: state.sponsorBlockEnabled,
    sponsorBlockCategories: state.sponsorBlockCategories,
    aiContentFilter: state.aiContentFilter,
    setDspOption: state.setDspOption,
    setCrossfade: state.setCrossfade,
    setSmartDjAutomix: state.setSmartDjAutomix,
    setAutomixMode: state.setAutomixMode,
    setGaplessAlbum: state.setGaplessAlbum,
    setEqualizerState: state.setEqualizerState,
    setPreferredAudioSource: state.setPreferredAudioSource,
    toggleSourceEnabled: state.toggleSourceEnabled,
    setUniversalFallback: state.setUniversalFallback,
    setAutoUpgradeLossless: state.setAutoUpgradeLossless,
    setCanvasEnabled: state.setCanvasEnabled,
    setLyricsSettings: state.setLyricsSettings,
  })));

  const { syncingAll, syncAllPlatforms } = useAccountsStore();
  const { changeSpeed, toggleNormalization } = usePlayer();

  const [settingsCategory, setSettingsCategory] = useState<
    'all' | 'ui' | 'sources' | 'audio' | 'lyrics' | 'system'
  >('all');
  const [extSettings, setExtSettings] = useState({
    autoSwitchThreshold: 88,
    preferLosslessOverExact: true,
    autoSyncSpotify: true,
    autoSyncYtm: true,
    autoSyncSc: true,
    replayGainMode: 'track' as 'off' | 'track' | 'album',
    targetLoudnessLufs: -14,
    keyboardShortcutsEnabled: true,
  });

  useEffect(() => {
    window.electronAPI?.db?.getInitialState?.().then((db) => {
      if (db?.settings) {
        setExtSettings((prev) => ({
          ...prev,
          autoSwitchThreshold: db.settings.autoSwitchThreshold ?? 88,
          preferLosslessOverExact: db.settings.preferLosslessOverExact ?? true,
          autoSyncSpotify: db.settings.autoSyncSpotify ?? true,
          autoSyncYtm: db.settings.autoSyncYtm ?? true,
          autoSyncSc: db.settings.autoSyncSc ?? true,
          replayGainMode: db.settings.replayGainMode ?? 'track',
          targetLoudnessLufs: db.settings.targetLoudnessLufs ?? -14,
          keyboardShortcutsEnabled: db.settings.keyboardShortcutsEnabled ?? true,
        }));
      }
    });
  }, []);

  const updateExtSetting = (patch: Partial<typeof extSettings>) => {
    setExtSettings((prev) => ({ ...prev, ...patch }));
    setDspOption(patch as any);
  };

  const [audioDevices, setAudioDevices] = useState<Array<{ id: string; description: string }>>([]);
  const [apiKey, setApiKey] = useState(lastfmApiKey);
  const [apiSecret, setApiSecret] = useState(lastfmSecret);
  const [sessionKey, setSessionKey] = useState(lastfmSessionKey);
  const [lbToken, setLbToken] = useState(listenBrainzToken);

  useEffect(() => {
    setApiKey(lastfmApiKey);
    setApiSecret(lastfmSecret);
    setSessionKey(lastfmSessionKey);
    setLbToken(listenBrainzToken);
  }, [lastfmApiKey, lastfmSecret, lastfmSessionKey, listenBrainzToken]);

  useEffect(() => {
    window.electronAPI?.player
      ?.getAudioDevices()
      .then((list) => {
        if (Array.isArray(list)) setAudioDevices(list);
      })
      .catch(() => {});
  }, []);

  const handleAudioDeviceChange = async (dev: string) => {
    await window.electronAPI?.player?.setAudioDevice(dev);
    setDspOption({ audioDevice: dev });
    pushToast('Аудио-выход обновлён', 'success');
  };

  const handleSaveScrobble = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await window.electronAPI?.scrobble?.configure(apiKey, apiSecret, sessionKey);
      setDesktopSetting({
        lastfmApiKey: apiKey,
        lastfmSecret: apiSecret,
        lastfmSessionKey: sessionKey,
        listenBrainzToken: lbToken,
      });
      if (res?.ok) {
        pushToast('Настройки Last.fm & ListenBrainz сохранены', 'success');
      } else {
        pushToast('Параметры сохранены локально', 'info');
      }
    } catch {
      pushToast('Ошибка сохранения Last.fm', 'error');
    }
  };

  const handleToggleSbCategory = (catId: string) => {
    const exists = sponsorBlockCategories.includes(catId);
    const next = exists
      ? sponsorBlockCategories.filter((c) => c !== catId)
      : [...sponsorBlockCategories, catId];
    setDspOption({ sponsorBlockCategories: next });
  };

  const handleExportBackup = async () => {
    const res = await window.electronAPI?.db?.exportBackup();
    if (res?.ok) pushToast(`Бэкап сохранён: ${res.filePath}`, 'success');
    else pushToast('Экспорт отменён', 'info');
  };

  const handleImportBackup = async () => {
    const res = await window.electronAPI?.db?.importBackup();
    if (res?.state) {
      pushToast('Резервная копия восстановлена. Перезапустите приложение, чтобы применить изменения.', 'success');
    }
  };

  return (
    <div className="screen screen-settings">
      <header className="screen-header">
        <h1>Настройки</h1>
        <button
          onClick={() => void syncAllPlatforms(true)}
          disabled={syncingAll}
          className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold shadow-md hover:opacity-90 disabled:opacity-50"
        >
          {syncingAll ? 'Синхронизация…' : 'Синхронизировать медиатеку'}
        </button>
      </header>

      {/* Category Filter Tabs */}
      <div role="group" aria-label="Разделы настроек" className="filter-group">
        {[
          { id: 'all', label: 'Все' },
          { id: 'sources', label: 'Источники' },
          { id: 'audio', label: 'Звук' },
          { id: 'ui', label: 'Интерфейс' },
          { id: 'lyrics', label: 'Тексты и видео' },
          { id: 'system', label: 'Система' },
        ].map((cat) => (
          <button
            key={cat.id}
            aria-pressed={settingsCategory === cat.id}
            onClick={() => setSettingsCategory(cat.id as any)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition ${
              settingsCategory === cat.id
                ? 'bg-primary text-on-primary shadow-sm'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* 1. Theme, UI Scale, Visualizer & Player Styles */}
      {(settingsCategory === 'all' || settingsCategory === 'ui') && (
      <section className="settings-section p-5 space-y-5">
        <div className="flex items-center gap-3">
          <Palette className="text-primary" size={22} />
          <div>
            <h2 className="text-base font-bold text-on-surface">
              Оформление
            </h2>
            <p className="text-xs text-on-surface-variant">
              Тема, масштаб и внешний вид плеера
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-on-surface-variant mb-2 block">Тема</label>
            <div className="flex gap-2">
              {(['dark', 'amoled', 'light'] as const).map((mode) => (
                <button
                  key={mode}
                  aria-pressed={theme === mode}
                  onClick={() => setTheme(mode)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    theme === mode
                      ? 'bg-primary text-on-primary shadow'
                      : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest'
                  }`}
                >
                  {{ dark: 'Тёмная', amoled: 'AMOLED', light: 'Светлая' }[mode]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-on-surface-variant">Масштаб интерфейса</label>
              <span className="text-xs font-bold text-primary tabular-nums">{Math.round(uiScale * 100)}%</span>
            </div>
            <input
              type="range"
              aria-label="Масштаб интерфейса"
              min={0.85}
              max={1.25}
              step={0.05}
              value={uiScale}
              onChange={(e) => setUiScale(parseFloat(e.target.value))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-xl bg-surface-container-high">
          <div>
            <span className="text-sm font-semibold text-on-surface">Цвета из обложки</span>
            <p className="text-xs text-on-surface-variant">Меняет акцент интерфейса при смене трека</p>
          </div>
          <button
            aria-pressed={dynamicColorFromArt}
            onClick={() => setDynamicColorFromArt(!dynamicColorFromArt)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
              dynamicColorFromArt ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'
            }`}
          >
            {dynamicColorFromArt ? 'Автоматически' : 'Вручную'}
          </button>
        </div>

        <div>
          <label className="text-xs font-semibold text-on-surface-variant mb-2 block">Базовый цвет</label>
          <div className="flex flex-wrap gap-3">
            {SEED_COLORS.map((c) => (
              <button
                key={c.hex}
                onClick={() => setSeedColor(c.hex)}
                className={`w-8 h-8 rounded-full transition-transform ${
                  seedColor === c.hex ? 'scale-110 ring-2 ring-primary ring-offset-2 ring-offset-surface' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c.hex }}
                title={c.name}
              />
            ))}
            <input
              type="color"
              aria-label="Свой базовый цвет"
              title="Свой базовый цвет"
              value={seedColor}
              onChange={(event) => setSeedColor(event.target.value)}
              className="color-picker"
            />
          </div>
        </div>

        <div role="group" aria-labelledby="glass-effect-label" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-high p-3">
          <span id="glass-effect-label" className="text-sm font-semibold">Матовое стекло</span>
          <div className="flex flex-wrap gap-2">
            {([
              ['off', 'Без размытия'], ['soft', 'Мягкое'], ['full', 'Выраженное'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={glassEffect === value}
                onClick={() => setAppearance({ glassEffect: value })}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                  glassEffect === value ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Audio Visualizer */}
        <div className="flex items-center justify-between flex-wrap gap-3 p-3 rounded-xl bg-surface-container-high">
          <div className="flex items-center gap-2.5">
            <Activity size={18} className="text-primary" />
            <div>
              <span className="text-sm font-semibold text-on-surface">Визуализатор</span>
              <p className="text-xs text-on-surface-variant">Отображение спектра в полноэкранном плеере</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(['bars', 'wave', 'circular'] as const).map((st) => (
              <button
                key={st}
                aria-pressed={visualizerEnabled && visualizerStyle === st}
                onClick={() => setVisualizer(true, st)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold capitalize ${
                  visualizerEnabled && visualizerStyle === st
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                {{ bars: 'Столбцы', wave: 'Волна', circular: 'Круг' }[st]}
              </button>
            ))}
            <button
              aria-pressed={visualizerEnabled}
              onClick={() => setVisualizer(!visualizerEnabled)}
              className={`px-3 py-1 rounded-lg text-[11px] font-bold ${
                visualizerEnabled ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              {visualizerEnabled ? 'Включён' : 'Выключен'}
            </button>
          </div>
        </div>

        <section aria-labelledby="motion-preset-heading" className="rounded-2xl bg-surface-container-high/70 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="motion-preset-heading" className="text-sm font-bold">Анимации интерфейса</h3>
            <button
              type="button"
              onClick={() => setPreviewAtEnd(value => !value)}
              disabled={reducedMotion}
              className="rounded-xl bg-primary/15 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/25 disabled:opacity-50"
            >
              Проверить анимацию
            </button>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(Object.keys(INTERFACE_MOTION_PRESETS) as Array<keyof typeof INTERFACE_MOTION_PRESETS>).map(id => {
              const preset = INTERFACE_MOTION_PRESETS[id];
              const selected = id === presetId;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setAppearance({ interfaceMotionPreset: id });
                    if (!reducedMotion) setPreviewAtEnd(value => !value);
                  }}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    selected ? 'border-primary/55 bg-primary/15' : 'border-transparent bg-surface-container hover:bg-surface-container-highest'
                  }`}
                >
                  <span>
                    <span className="block text-xs font-bold">{preset.label}</span>
                    <span className="mt-0.5 block text-[11px] text-on-surface-variant">{preset.description}</span>
                  </span>
                  {selected && <Check size={15} className="shrink-0 text-primary" aria-hidden />}
                </button>
              );
            })}
          </div>
          {reducedMotion ? (
            <p className="text-xs text-on-surface-variant">Сокращение движения включено. Пресет сохранится для обычного режима.</p>
          ) : (
            <div aria-hidden="true" className="relative mx-2 flex h-7 items-center">
              <span className="absolute inset-x-0 h-px bg-primary/25" />
              <motion.span
                initial={false}
                animate={{ left: previewAtEnd ? '88%' : '12%' }}
                transition={panelTransition}
                className="absolute -ml-2 h-4 w-4 rounded-full bg-primary"
              />
            </div>
          )}
        </section>

        {/* 8 Player Styles */}
        <div>
          <label className="text-xs font-semibold text-on-surface-variant mb-2 block">Стиль полноэкранного плеера</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {PLAYER_STYLES.map((st) => {
              const active = playerStyle === st.id;
              return (
                <button
                  key={st.id}
                  onClick={() => setPlayerStyle(st.id)}
                  className={`text-left p-3 rounded-xl  transition-all ${
                    active
                      ? 'bg-primary/15  text-on-surface'
                      : 'bg-surface-container-high  text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <p className="text-xs font-bold text-on-surface">{st.name}</p>
                  <p className="text-[11px] text-on-surface-variant mt-0.5">{st.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Extra UI Module Toggles (Fooyin / Amberol / Tauon inspired) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
          <button
            onClick={() => setAppearance({ ambientBackgroundBlur: !ambientBackgroundBlur })}
            className="flex items-center justify-between p-3 rounded-xl bg-surface-container-high text-left"
          >
            <div>
              <p className="text-xs font-bold text-on-surface">Размытая обложка на фоне</p>
              <p className="text-[11px] text-on-surface-variant">Динамическая подсветка из обложки на фоне</p>
            </div>
            <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${ambientBackgroundBlur ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'}`}>
              {ambientBackgroundBlur ? 'Вкл' : 'Выкл'}
            </span>
          </button>
          <button
            aria-pressed={reduceInterfaceMotion}
            onClick={() => setAppearance({ reduceInterfaceMotion: !reduceInterfaceMotion })}
            className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-container-high text-left"
          >
            <div>
              <p className="text-xs font-bold text-on-surface">Меньше анимации</p>
              <p className="text-[11px] text-on-surface-variant">Без пружинных переходов, инерции карусели и движения визуализатора</p>
            </div>
            <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
              reduceInterfaceMotion ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'
            }`}>{reduceInterfaceMotion ? 'Вкл' : 'Выкл'}</span>
          </button>
          <button
            onClick={() => setAppearance({ compactTrackRows: !compactTrackRows })}
            className="flex items-center justify-between p-3 rounded-xl bg-surface-container-high text-left"
          >
            <div>
              <p className="text-xs font-bold text-on-surface">Компактные списки треков</p>
              <p className="text-[11px] text-on-surface-variant">Уменьшенные отступы для больших медиатек</p>
            </div>
            <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${compactTrackRows ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'}`}>
              {compactTrackRows ? 'Вкл' : 'Выкл'}
            </span>
          </button>
        </div>
      </section>
      )}

      {/* 2. Audio Engine, Output Device, AutoMix & DSP */}
      {(settingsCategory === 'all' || settingsCategory === 'audio') && (
      <section className="settings-section p-5 space-y-5">
        <div className="flex items-center gap-3">
          <Volume2 className="text-primary" size={22} />
          <div>
            <h2 className="text-base font-bold text-on-surface">
              Воспроизведение и звук
            </h2>
            <p className="text-xs text-on-surface-variant">
              Устройство вывода ALSA/Pulse/PipeWire, кроссфейд, питч, бас-буст и экспандер громкости
            </p>
          </div>
        </div>

        {/* Audio output device selector */}
        <div>
          <label className="text-xs font-semibold text-on-surface-variant mb-2 block">
            Устройство вывода
          </label>
          <select
            value={audioDevice || 'auto'}
            onChange={(e) => void handleAudioDeviceChange(e.target.value)}
            className="w-full bg-surface-container-high rounded-xl px-3.5 py-2.5 text-xs font-semibold text-on-surface outline-none"
          >
            <option value="auto">По умолчанию (Auto PipeWire / PulseAudio)</option>
            {audioDevices.map((dev) => (
              <option key={dev.id} value={dev.id}>
                {dev.description || dev.id}
              </option>
            ))}
          </select>
        </div>

        {/* Automix Mode selector */}
        <div>
          <label className="text-xs font-semibold text-on-surface-variant mb-2 block">Режим перехода AutoMix</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {AUTOMIX_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setAutomixMode(m.id)}
                className={`p-2.5 rounded-xl text-left  transition-all ${
                  automixMode === m.id
                    ? 'bg-primary/15 '
                    : 'bg-surface-container-high  '
                }`}
              >
                <p className="text-xs font-bold text-on-surface">{m.label}</p>
                <p className="text-[10px] text-on-surface-variant mt-0.5">{m.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Sliders */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-3 rounded-xl bg-surface-container-high space-y-2">
            <div className="flex justify-between text-xs font-bold">
              <span>Кроссфейд (Crossfade)</span>
              <span className="text-primary">{crossfade} сек</span>
            </div>
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={crossfade}
              onChange={(e) => setCrossfade(Number(e.target.value))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          <div className="p-3 rounded-xl bg-surface-container-high space-y-2">
            <div className="flex justify-between text-xs font-bold">
              <span>Скорость (Tempo / Speed)</span>
              <span className="text-primary">{speed.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={speed}
              onChange={(e) => void changeSpeed(Number(e.target.value))}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          <div className="p-3 rounded-xl bg-surface-container-high space-y-2">
            <div className="flex justify-between text-xs font-bold">
              <span>Сдвиг тона (Pitch Shift)</span>
              <span className="text-primary">{pitchSemitones > 0 ? `+${pitchSemitones}` : pitchSemitones} st</span>
            </div>
            <input
              type="range"
              min={-6}
              max={6}
              step={1}
              value={pitchSemitones}
              onChange={(e) => setDspOption({ pitchSemitones: Number(e.target.value) })}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          <div className="p-3 rounded-xl bg-surface-container-high space-y-2">
            <div className="flex justify-between text-xs font-bold">
              <span>Bass Boost (+60Hz)</span>
              <span className="text-primary">+{bassBoost} dB</span>
            </div>
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={bassBoost}
              onChange={(e) => setDspOption({ bassBoost: Number(e.target.value) })}
              className="w-full accent-primary cursor-pointer"
            />
          </div>

          <div className="p-3 rounded-xl bg-surface-container-high space-y-2 sm:col-span-2">
            <div className="flex justify-between text-xs font-bold">
              <span>Stereo Widener (Пространственная сцена)</span>
              <span className="text-primary">{Math.round(stereoWidener * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={stereoWidener}
              onChange={(e) => setDspOption({ stereoWidener: Number(e.target.value) })}
              className="w-full accent-primary cursor-pointer"
            />
          </div>
        </div>

        {/* Boolean DSP switches */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[
            { label: 'Smart DJ Automix', desc: 'Умный подбор переходов', val: smartDjAutomix, fn: () => setSmartDjAutomix(!smartDjAutomix) },
            { label: 'Gapless внутри альбома', desc: 'Бесшовное переключение', val: gaplessAlbum, fn: () => setGaplessAlbum(!gaplessAlbum) },
            { label: 'Нормализация (dynaudnorm)', desc: 'Выравнивание громкости', val: normalization, fn: () => void toggleNormalization(!normalization) },
            { label: 'Аудио-компрессор', desc: 'Мягкий лимитер пиков', val: audioCompressor, fn: () => setDspOption({ audioCompressor: !audioCompressor }) },
            { label: 'Плавная регулировка громкости', desc: 'Более точная настройка на малой громкости', val: exponentialVolume, fn: () => setDspOption({ exponentialVolume: !exponentialVolume }) },
            { label: 'Пропуск тишины (Skip Silence)', desc: 'Обрезка тихих пауз в начале и конце', val: silenceSkip, fn: () => setDspOption({ silenceSkip: !silenceSkip }) },
            { label: 'Авто-радио после конца очереди', desc: 'Бесконечный автоплей похожих треков', val: autoRadioOnQueueEnd, fn: () => setDspOption({ autoRadioOnQueueEnd: !autoRadioOnQueueEnd }) },
            { label: 'Предзагрузка трека (Deck B Prebuffer)', desc: 'Мгновенный старт следующего трека в памяти', val: prebufferNextTrack, fn: () => setDspOption({ prebufferNextTrack: !prebufferNextTrack }) },
          ].map((item) => (
            <button
              key={item.label}
              onClick={item.fn}
              className="flex items-center justify-between p-3 rounded-xl bg-surface-container-high text-left"
            >
              <div>
                <p className="text-xs font-bold text-on-surface">{item.label}</p>
                <p className="text-[11px] text-on-surface-variant">{item.desc}</p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                  item.val ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'
                }`}
              >
                {item.val ? 'Вкл' : 'Выкл'}
              </span>
            </button>
          ))}
        </div>

        {/* 10-Band Parametric Equalizer directly in Settings */}
        <div className="p-4 rounded-2xl bg-surface-container-high space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Sliders size={18} className="text-primary" />
              <span className="text-sm font-bold text-on-surface">10-полосный параметрический эквалайзер</span>
              <button
                onClick={() => setEqualizerState(!eqEnabled, eqBands, eqPreset)}
                className={`px-3 py-1 rounded-lg text-xs font-bold ${
                  eqEnabled ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'
                }`}
              >
                {eqEnabled ? 'ВКЛ' : 'ВЫКЛ (BYPASS)'}
              </button>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {Object.keys(EQ_PRESET_MAP).map((presetName) => (
                <button
                  key={presetName}
                  onClick={() => setEqualizerState(true, EQ_PRESET_MAP[presetName], presetName)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                    eqPreset === presetName && eqEnabled
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {presetName}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 pt-2">
            {EQ_LABELS.map((label, idx) => {
              const val = eqBands[idx] ?? 0;
              return (
                <div key={label} className="flex flex-col items-center bg-surface-container p-2 rounded-xl gap-1.5">
                  <span className="text-[10px] font-bold text-primary tabular-nums">
                    {val > 0 ? `+${val}` : val}dB
                  </span>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    step={0.5}
                    value={val}
                    onChange={(e) => {
                      const nextBands = [...eqBands];
                      nextBands[idx] = parseFloat(e.target.value);
                      setEqualizerState(true, nextBands, 'Custom');
                    }}
                    className="w-full accent-primary cursor-pointer"
                  />
                  <span className="text-[10px] text-on-surface-variant font-semibold">{label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {/* 3. Multi-Source & Smart Routing + Unified Library Sync */}
      {(settingsCategory === 'all' || settingsCategory === 'sources') && (
      <section className="settings-section p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Radio className="text-primary" size={22} />
            <div>
              <h2 className="text-base font-bold text-on-surface">Источники звука</h2>
              <p className="text-xs text-on-surface-variant">Приоритет платформ и уведомления автопереключения</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/integrations')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold"
          >
            <PlugZap size={14} /> Интеграции &amp; Зеркала
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {(
            [
              { id: 'auto', label: 'Авто' },
              { id: 'spotify', label: 'Spotify' },
              { id: 'tidal', label: 'Tidal FLAC' },
              { id: 'qobuz', label: 'Qobuz Hi-Res' },
              { id: 'youtube', label: 'YouTube Music' },
              { id: 'deezer', label: 'Deezer' },
              { id: 'jiosaavn', label: 'JioSaavn' },
              { id: 'soundcloud', label: 'SoundCloud' },
            ] as Array<{ id: 'auto' | AudioSourceId; label: string }>
          ).map((src) => (
            <button
              key={src.id}
              onClick={() => setPreferredAudioSource(src.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                preferredAudioSource === src.id
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {src.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[
            { label: 'Умный авто-выбор лучшего источника (Smart Auto-Switch)', desc: 'Авто-переключение на FLAC/Hi-Res при высоком совпадении', val: autoUpgradeLossless, fn: () => setAutoUpgradeLossless(!autoUpgradeLossless) },
            { label: 'Приоритет Lossless над 100% совпадением', desc: 'Выбирать FLAC даже если lossy-источник ближе на 1-2%', val: extSettings.preferLosslessOverExact, fn: () => updateExtSetting({ preferLosslessOverExact: !extSettings.preferLosslessOverExact }) },
            { label: 'Universal Fallback (Резервный поиск)', desc: 'Авто-переход на рабочее зеркало при ошибке потока', val: universalFallback, fn: () => setUniversalFallback(!universalFallback) },
            {
              label: 'Smart Switch уведомления (Тосты)',
              desc: 'Показывать всплывающий бейдж при смене источника',
              val: showSmartSwitchToasts,
              fn: () => setDesktopSetting({ showSmartSwitchToasts: !showSmartSwitchToasts }),
            },
          ].map((b) => (
            <button
              key={b.label}
              onClick={b.fn}
              className="flex items-center justify-between p-3 rounded-xl bg-surface-container-high text-left"
            >
              <div>
                <p className="text-xs font-bold text-on-surface">{b.label}</p>
                <p className="text-[11px] text-on-surface-variant">{b.desc}</p>
              </div>
              <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${b.val ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                {b.val ? 'Вкл' : 'Выкл'}
              </span>
            </button>
          ))}
        </div>

        {/* Smart Auto-Switch Match Threshold Slider */}
        <div className="p-3.5 rounded-xl bg-surface-container-high space-y-2">
          <div className="flex justify-between text-xs font-bold">
            <span>Порог схожести трека для авто-переключения (Smart Match Threshold)</span>
            <span className="text-primary">{extSettings.autoSwitchThreshold}% совпадение</span>
          </div>
          <input
            type="range"
            min={70}
            max={98}
            step={1}
            value={extSettings.autoSwitchThreshold}
            onChange={(e) => updateExtSetting({ autoSwitchThreshold: Number(e.target.value) })}
            className="w-full accent-primary cursor-pointer"
          />
          <p className="text-[11px] text-on-surface-variant">
            Если найденный на Tidal / Qobuz / Deezer трек совпадает по названию, артисту и длительности минимум на {extSettings.autoSwitchThreshold}%, плеер сам переключится на него.
          </p>
        </div>

        {/* Enable / Disable Individual Audio Providers */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-on-surface-variant block">
            Включённые аудио-провайдеры (можно отключить любой источник):
          </label>
          <div className="flex flex-wrap gap-2">
            {(['tidal', 'qobuz', 'deezer', 'youtube', 'soundcloud', 'jiosaavn', 'apple', 'spotify'] as AudioSourceId[]).map((src) => {
              const active = enabledSources?.[src] !== false;
              return (
                <button
                  key={src}
                  onClick={() => toggleSourceEnabled(src, !active)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold  transition ${
                    active
                      ? 'bg-emerald-500/15 text-emerald-300 '
                      : 'bg-surface-container-high text-on-surface-variant  opacity-60'
                  }`}
                >
                  {src.toUpperCase()}: {active ? 'ВКЛ' : 'ВЫКЛ'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Unified Library Sync Toggles */}
        <div className="pt-2 space-y-2.5">
          <p className="text-xs font-bold text-on-surface">
            Общая медиатека (авто-объединение Любимых треков и Плейлистов со всех платформ):
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {[
              { label: 'Синхр. Spotify', val: extSettings.autoSyncSpotify, fn: () => updateExtSetting({ autoSyncSpotify: !extSettings.autoSyncSpotify }) },
              { label: 'Синхр. YouTube Music', val: extSettings.autoSyncYtm, fn: () => updateExtSetting({ autoSyncYtm: !extSettings.autoSyncYtm }) },
              { label: 'Синхр. SoundCloud', val: extSettings.autoSyncSc, fn: () => updateExtSetting({ autoSyncSc: !extSettings.autoSyncSc }) },
            ].map((s) => (
              <button
                key={s.label}
                onClick={s.fn}
                className="flex items-center justify-between p-3 rounded-xl bg-surface-container-high text-xs font-bold"
              >
                <span className="text-on-surface">{s.label}</span>
                <span className={s.val ? 'text-emerald-400' : 'text-on-surface-variant'}>
                  {s.val ? 'Вкл' : 'Выкл'}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>
      )}

      {/* 4. Lyrics, Canvas & AI Content Filter */}
      {(settingsCategory === 'all' || settingsCategory === 'lyrics') && (
      <section className="settings-section p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Sparkles className="text-primary" size={22} />
          <div>
            <h2 className="text-base font-bold text-on-surface">Тексты песен и Canvas</h2>
            <p className="text-xs text-on-surface-variant">Караоке по словам, транслитерация, сдвиг тайминга и фильтр AI-контента</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[
            { label: 'Word-by-Word караоке', val: lyricsWordByWord, fn: () => setLyricsSettings({ lyricsWordByWord: !lyricsWordByWord }) },
            { label: 'Транслитерация (Ромадзи/Romaja)', val: lyricsRomanize, fn: () => setLyricsSettings({ lyricsRomanize: !lyricsRomanize }) },
            { label: 'Авто-перевод текста', val: lyricsTranslate, fn: () => setLyricsSettings({ lyricsTranslate: !lyricsTranslate }) },
            { label: 'Motion Canvas / Видеофоны', val: canvasEnabled, fn: () => setCanvasEnabled(!canvasEnabled) },
            { label: 'Скрывать AI-генерацию', val: aiContentFilter, fn: () => setDspOption({ aiContentFilter: !aiContentFilter }) },
          ].map((it) => (
            <button
              key={it.label}
              onClick={it.fn}
              className="flex items-center justify-between p-3 rounded-xl bg-surface-container-high text-xs font-bold"
            >
              <span className="text-on-surface">{it.label}</span>
              <span className={`px-2.5 py-1 rounded-lg ${it.val ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'}`}>
                {it.val ? 'Вкл' : 'Выкл'}
              </span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-surface-container-high space-y-1">
            <label className="text-[11px] font-bold text-on-surface-variant">Размер шрифта текста</label>
            <div className="flex gap-1.5 pt-1">
              {(['small', 'medium', 'large'] as const).map((sz) => (
                <button
                  key={sz}
                  onClick={() => setLyricsSettings({ lyricsFontSize: sz })}
                  className={`flex-1 py-1 rounded-lg text-[11px] font-bold uppercase ${
                    lyricsFontSize === sz ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  {sz}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-surface-container-high space-y-1">
            <label className="text-[11px] font-bold text-on-surface-variant">Язык перевода</label>
            <input
              type="text"
              value={lyricsTranslateLang}
              onChange={(e) => setLyricsSettings({ lyricsTranslateLang: e.target.value })}
              className="w-full bg-surface-container rounded-lg px-2.5 py-1 text-xs text-on-surface outline-none"
            />
          </div>

          <div className="p-3 rounded-xl bg-surface-container-high space-y-1">
            <div className="flex justify-between text-[11px] font-bold">
              <span className="text-on-surface-variant">Синхронизация</span>
              <span className="text-primary">{lyricsOffset} ms</span>
            </div>
            <input
              type="range"
              min={-3000}
              max={3000}
              step={100}
              value={lyricsOffset}
              onChange={(e) => setLyricsSettings({ lyricsOffset: Number(e.target.value) })}
              className="w-full accent-primary cursor-pointer"
            />
          </div>
        </div>
      </section>
      )}

      {/* 5. SponsorBlock */}
      {(settingsCategory === 'all' || settingsCategory === 'lyrics') && (
      <section className="settings-section p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="text-primary" size={22} />
            <div>
              <h2 className="text-base font-bold text-on-surface">SponsorBlock (YouTube Music)</h2>
              <p className="text-xs text-on-surface-variant">Автоматический пропуск интро, рекламы и немузыкальных вставок</p>
            </div>
          </div>
          <button
            onClick={() => setDspOption({ sponsorBlockEnabled: !sponsorBlockEnabled })}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-bold ${
              sponsorBlockEnabled ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'
            }`}
          >
            {sponsorBlockEnabled ? 'Включено' : 'Отключено'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {SPONSORBLOCK_CATEGORIES.map((cat) => {
            const active = sponsorBlockCategories.includes(cat.id);
            return (
              <button
                key={cat.id}
                onClick={() => handleToggleSbCategory(cat.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${
                  active ? 'bg-primary/20 text-primary  ' : 'bg-surface-container-high text-on-surface-variant'
                }`}
              >
                {active && <Check size={12} />}
                {cat.label}
              </button>
            );
          })}
        </div>
      </section>
      )}

      {(settingsCategory === 'all' || settingsCategory === 'system') && <CacheSettings />}

      {/* 6. Desktop, Local HTTP API & Scrobbling */}
      {(settingsCategory === 'all' || settingsCategory === 'system') && (
      <section className="settings-section p-5 space-y-5">
        <div className="flex items-center gap-3">
          <Monitor className="text-primary" size={22} />
          <div>
            <h2 className="text-base font-bold text-on-surface">Системная интеграция</h2>
            <p className="text-xs text-on-surface-variant">Системный трей, MPRIS2, Discord RPC, локальный сервер :26538, Last.fm и ListenBrainz</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {[
            { label: 'Сворачивать в трей при закрытии', val: closeToTray, fn: () => setDesktopSetting({ closeToTray: !closeToTray }) },
            { label: 'Linux MPRIS2 медиа-контролы', val: mprisEnabled, fn: () => setDesktopSetting({ mprisEnabled: !mprisEnabled }) },
            { label: 'Discord Rich Presence', val: discordRpc, fn: () => setDesktopSetting({ discordRpc: !discordRpc }) },
            { label: 'Local HTTP API (127.0.0.1:26538)', val: localApiEnabled, fn: () => setDesktopSetting({ localApiEnabled: !localApiEnabled }) },
            { label: 'Аппаратное ускорение GPU (перезапуск)', val: hardwareAcceleration, fn: () => setDesktopSetting({ hardwareAcceleration: !hardwareAcceleration }) },
            { label: 'ListenBrainz Scrobbling', val: listenBrainzEnabled, fn: () => setDesktopSetting({ listenBrainzEnabled: !listenBrainzEnabled }) },
          ].map((it) => (
            <button
              key={it.label}
              onClick={it.fn}
              className="flex items-center justify-between p-3 rounded-xl bg-surface-container-high text-xs font-bold"
            >
              <span className="text-on-surface">{it.label}</span>
              <span className={it.val ? 'text-primary' : 'text-on-surface-variant'}>
                {it.val ? 'Вкл' : 'Выкл'}
              </span>
            </button>
          ))}
        </div>

        <form onSubmit={handleSaveScrobble} className="space-y-3 pt-2">
          <p className="text-xs font-bold text-on-surface-variant">Last.fm &amp; ListenBrainz API</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Last.fm API Key"
              className="bg-surface-container-high px-3 py-2 rounded-xl text-xs text-on-surface outline-none"
            />
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="Last.fm API Secret"
              className="bg-surface-container-high px-3 py-2 rounded-xl text-xs text-on-surface outline-none"
            />
            <input
              type="text"
              value={sessionKey}
              onChange={(e) => setSessionKey(e.target.value)}
              placeholder="Last.fm Session Key"
              className="bg-surface-container-high px-3 py-2 rounded-xl text-xs text-on-surface outline-none"
            />
            <input
              type="password"
              value={lbToken}
              onChange={(e) => setLbToken(e.target.value)}
              placeholder="ListenBrainz User Token"
              className="bg-surface-container-high px-3 py-2 rounded-xl text-xs text-on-surface outline-none"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-bold"
          >
            Сохранить ключи скробблинга
          </button>
        </form>
      </section>
      )}

      {/* 7. Downloads & Full Backup / Restore */}
      {(settingsCategory === 'all' || settingsCategory === 'system') && (
      <section className="settings-section p-5 space-y-4">
        <div className="flex items-center gap-3">
          <Download className="text-primary" size={22} />
          <div>
            <h2 className="text-base font-bold text-on-surface">Загрузки и резервные копии</h2>
            <p className="text-xs text-on-surface-variant">Формат оффлайн-сохранения и полный бэкап библиотеки</p>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-on-surface-variant">Формат загрузки:</span>
            {(['flac', 'mp3', 'opus'] as const).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setDesktopSetting({ downloadFormat: fmt })}
                className={`px-3 py-1 rounded-lg text-xs font-bold uppercase ${
                  downloadFormat === fmt ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          <button
            onClick={() => setDesktopSetting({ embedMetadataAndLyrics: !embedMetadataAndLyrics })}
            className="px-3 py-1.5 rounded-xl bg-surface-container-high text-xs font-bold text-on-surface"
          >
            Вшивать теги и обложку: {embedMetadataAndLyrics ? 'Да' : 'Нет'}
          </button>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleExportBackup}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/15 text-primary text-xs font-bold hover:bg-primary/25"
          >
            <HardDriveDownload size={14} /> Экспорт бэкапа (.json)
          </button>
          <button
            onClick={handleImportBackup}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container-high text-on-surface text-xs font-bold hover:bg-surface-container-highest"
          >
            Восстановить из бэкапа
          </button>
        </div>

        {/* Keyboard Shortcuts Reference */}
        <div className="pt-3 space-y-2">
          <p className="text-xs font-bold text-on-surface">Горячие клавиши плеера:</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-on-surface-variant">
            <div className="p-2 rounded-lg bg-surface-container-high"><strong className="text-primary">Space</strong> — Пауза / Старт</div>
            <div className="p-2 rounded-lg bg-surface-container-high"><strong className="text-primary">Esc</strong> — Свернуть плеер / окно</div>
            <div className="p-2 rounded-lg bg-surface-container-high"><strong className="text-primary">← / →</strong> — Перемотка ±5 сек</div>
            <div className="p-2 rounded-lg bg-surface-container-high"><strong className="text-primary">J / L</strong> — Перемотка ±10 сек</div>
            <div className="p-2 rounded-lg bg-surface-container-high"><strong className="text-primary">M</strong> — Mute / Звук</div>
            <div className="p-2 rounded-lg bg-surface-container-high"><strong className="text-primary">Ctrl+Q</strong> — Очередь</div>
            <div className="p-2 rounded-lg bg-surface-container-high"><strong className="text-primary">Ctrl+M</strong> — Мини-виджет PiP</div>
          </div>
        </div>
      </section>
      )}

      {/* About */}
      <section className="settings-section p-5 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Info className="text-primary" size={20} />
          <div>
            <p className="text-sm font-bold text-on-surface">ArchiveTune Desktop V2.0 RC</p>
            <p className="text-xs text-on-surface-variant">
              Вдохновлено S1LOnik/ArchiveTune, Feishin, Pear Desktop и Nuclear
            </p>
          </div>
        </div>
        <button
          onClick={() => window.electronAPI?.openExternal('https://github.com/S1LOnik/ArchiveTune')}
          className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
        >
          GitHub <ExternalLink size={12} />
        </button>
      </section>
    </div>
  );
}
