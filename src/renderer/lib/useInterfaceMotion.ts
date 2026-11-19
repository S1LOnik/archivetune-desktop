import { useSyncExternalStore } from 'react';
import type { Transition } from 'framer-motion';
import { useUIStore } from '../store';
import type { AppSettings } from '../types/electron';

type MotionPresetId = AppSettings['interfaceMotionPreset'];

interface MotionPreset {
  label: string;
  description: string;
  panel: Transition;
  control: Transition;
  hoverScale: number;
  carousel: { stiffness: number; damping: number; friction: number };
}

export const INTERFACE_MOTION_PRESETS = {
  balanced: {
    label: 'Мягкая пружина',
    description: 'Плавный ход и лёгкий отскок',
    panel: { type: 'spring', stiffness: 290, damping: 25 },
    control: { type: 'spring', stiffness: 450, damping: 24 },
    hoverScale: 1.034,
    carousel: { stiffness: 0.072, damping: 0.77, friction: 0.935 },
  },
  snappy: {
    label: 'Быстрая пружина',
    description: 'Короткий ход и быстрый отклик',
    panel: { type: 'spring', stiffness: 510, damping: 41 },
    control: { type: 'spring', stiffness: 660, damping: 39 },
    hoverScale: 1.025,
    carousel: { stiffness: 0.135, damping: 0.64, friction: 0.90 },
  },
  bouncy: {
    label: 'Упругая пружина',
    description: 'Заметный отскок при остановке',
    panel: { type: 'spring', stiffness: 310, damping: 18 },
    control: { type: 'spring', stiffness: 450, damping: 16 },
    hoverScale: 1.048,
    carousel: { stiffness: 0.081, damping: 0.85, friction: 0.947 },
  },
  smooth: {
    label: 'Плавная',
    description: 'Мягкое затухание без отскока',
    panel: { type: 'tween', duration: 0.32, ease: [0.22, 1, 0.36, 1] },
    control: { type: 'tween', duration: 0.18, ease: 'easeOut' },
    hoverScale: 1.025,
    carousel: { stiffness: 0.08, damping: 0.56, friction: 0.927 },
  },
} satisfies Record<MotionPresetId, MotionPreset>;

const reducedMotionQuery = typeof window === 'undefined'
  ? undefined
  : window.matchMedia('(prefers-reduced-motion: reduce)');

function subscribeToReducedMotion(onChange: () => void) {
  reducedMotionQuery?.addEventListener('change', onChange);
  return () => reducedMotionQuery?.removeEventListener('change', onChange);
}

function systemPrefersReducedMotion() {
  return reducedMotionQuery?.matches ?? false;
}

export function useInterfaceMotionReduced(): boolean {
  const systemReduced = useSyncExternalStore(subscribeToReducedMotion, systemPrefersReducedMotion);
  const userReduced = useUIStore((state) => state.reduceInterfaceMotion);
  return userReduced || systemReduced;
}

export function useInterfaceMotion() {
  const storedId = useUIStore((state) => state.interfaceMotionPreset);
  const reducedMotion = useInterfaceMotionReduced();
  const presetId = Object.hasOwn(INTERFACE_MOTION_PRESETS, storedId) ? storedId : 'balanced';
  const preset: MotionPreset = INTERFACE_MOTION_PRESETS[presetId];
  const noMotion = { duration: 0 };
  return {
    reducedMotion,
    presetId,
    preset,
    panelTransition: reducedMotion ? noMotion : preset.panel,
    controlTransition: reducedMotion ? noMotion : preset.control,
    hover: reducedMotion ? undefined : { scale: preset.hoverScale },
    press: reducedMotion ? undefined : { scale: 0.95 },
  };
}
