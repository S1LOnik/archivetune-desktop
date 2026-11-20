import React, { Suspense, lazy, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { motion, AnimatePresence } from 'framer-motion';
import { useInterfaceMotion } from './lib/useInterfaceMotion';
import { useSpotifyLyricsId } from './lib/useSpotifyLyricsId';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Sidebar from './components/Sidebar';
import TitleBar from './components/TitleBar';
import MiniPlayer from './components/MiniPlayer';
import QueueDrawer from './components/QueueDrawer';
import TrackContextMenu from './components/TrackContextMenu';
import SourceSwitcherModal from './components/SourceSwitcherModal';
import AcousticAuditModal from './components/AcousticAuditModal';
import TagEditorModal from './components/TagEditorModal';
import ToastContainer from './components/ToastContainer';
import HomePage from './pages/HomePage';
const NowPlayingOverlay = lazy(() => import('./components/NowPlayingOverlay'));
const ExplorePage = lazy(() => import('./pages/ExplorePage'));
const AlbumPage = lazy(() => import('./pages/AlbumPage'));
const ArtistPage = lazy(() => import('./pages/ArtistPage'));
const PlaylistDetailPage = lazy(() => import('./pages/PlaylistDetailPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const TogetherPage = lazy(() => import('./pages/TogetherPage'));
const StatsPage = lazy(() => import('./pages/StatsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
import {
  useUIStore,
  usePlayerStore,
  hydrateStoresFromDatabase,
  extractArtworkColors,
} from './store';
import { usePlayerEvents } from './lib/usePlayer';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

function AppAmbientLight() {
  const playing = usePlayerStore((state) => state.isPlaying);
  const enabled = useUIStore((state) => state.ambientBackgroundBlur);
  if (!enabled) return null;
  return <div className="app-ambient ambient-breath" data-playing={playing} aria-hidden="true" />;
}

function AppContent() {
  const location = useLocation();
  const { reducedMotion, panelTransition } = useInterfaceMotion();
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [location.pathname]);
  usePlayerEvents();
  const showNowPlaying = useUIStore((s) => s.showNowPlaying);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const spotifyLyricsId = useSpotifyLyricsId(currentTrack);

  useEffect(() => {
    void hydrateStoresFromDatabase();
  }, []);

  const { dynamicColorFromArt, seedColor, setActiveArtColor } = useUIStore(useShallow(
    ({ dynamicColorFromArt, seedColor, setActiveArtColor }) => ({ dynamicColorFromArt, seedColor, setActiveArtColor }),
  ));
  const thumbnail = currentTrack?.thumbnail;

  useEffect(() => {
    if (!currentTrack || !window.electronAPI?.lyrics) return;
    let cancelled = false;
    const track = currentTrack;
    void window.electronAPI.lyrics.get(track.title, track.artist, track.duration, track.id, spotifyLyricsId).then(result => {
      if (!cancelled && usePlayerStore.getState().currentTrack?.id === track.id) {
        window.electronAPI.desktop.updateLyrics(track.id, result.synced || []);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [currentTrack?.id, currentTrack?.title, currentTrack?.artist, currentTrack?.duration, spotifyLyricsId]);

  useEffect(() => {
    if (!dynamicColorFromArt) return;
    if (!thumbnail) {
      setActiveArtColor(null);
      return;
    }
    let cancelled = false;
    void extractArtworkColors(thumbnail, seedColor).then(({ color, gradients }) => {
      if (!cancelled) setActiveArtColor(color, gradients);
    }).catch(() => {
      if (!cancelled) setActiveArtColor(null);
    });
    return () => { cancelled = true; };
  }, [thumbnail, seedColor, dynamicColorFromArt, setActiveArtColor]);

  return (
    <div className="app-shell relative isolate flex flex-col h-full bg-surface text-on-surface overflow-hidden select-none">
      <AppAmbientLight />
      {/* Custom Titlebar */}
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <main ref={mainRef} className="app-content flex-1 overflow-y-auto overflow-x-hidden relative">
          <motion.div
            key={location.pathname}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...panelTransition, opacity: { duration: reducedMotion ? 0 : 0.14 } }}
          >
            <Suspense fallback={<div className="p-6 text-on-surface-variant" role="status">Загрузка…</div>}>
            <Routes location={location}>
              <Route path="/" element={<HomePage />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/explore" element={<ExplorePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/integrations" element={<IntegrationsPage />} />
              <Route path="/spotify" element={<IntegrationsPage />} />
              <Route path="/together" element={<TogetherPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/album/:id" element={<AlbumPage />} />
              <Route path="/artist/:id" element={<ArtistPage />} />
              <Route path="/playlist/:id" element={<PlaylistDetailPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
          </motion.div>
        </main>

        {/* Right Queue Drawer */}
        <QueueDrawer />
      </div>

      {/* Playback bar */}
      {currentTrack && <MiniPlayer />}

      {/* Full Now Playing Overlay */}
      <Suspense fallback={null}>
        <AnimatePresence>
          {showNowPlaying && <NowPlayingOverlay key="now-playing-overlay" />}
        </AnimatePresence>
      </Suspense>

      {/* Global Context Menu, Modals & Smart Switch Toasts */}
      <TrackContextMenu />
      <SourceSwitcherModal />
      <AcousticAuditModal />
      <TagEditorModal />
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </QueryClientProvider>
  );
}
