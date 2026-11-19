import React, { memo, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore, useUIStore } from '../store';
import { useInterfaceMotionReduced } from '../lib/useInterfaceMotion';

interface AudioVisualizerProps {
  className?: string;
  height?: number;
  styleOverride?: 'bars' | 'wave' | 'circular';
}

export default memo(function AudioVisualizer({
  className = '',
  height = 56,
  styleOverride,
}: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const animate = !useInterfaceMotionReduced() && isPlaying;
  const { visualizerEnabled, visualizerStyle, seedColor, activeArtColor, dynamicColorFromArt } =
    useUIStore(useShallow(({ visualizerEnabled, visualizerStyle, seedColor, activeArtColor, dynamicColorFromArt }) => ({
      visualizerEnabled, visualizerStyle, seedColor, activeArtColor, dynamicColorFromArt,
    })));

  const activeStyle = styleOverride ?? visualizerStyle;
  const accent = (dynamicColorFromArt && activeArtColor) || seedColor || '#cbb9f5';

  useEffect(() => {
    if (!visualizerEnabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const bins = 40;
    const levels = new Float32Array(bins).fill(0.12);
    const barGradient = ctx.createLinearGradient(0, canvas.height * 0.3, 0, canvas.height);
    barGradient.addColorStop(0, accent);
    barGradient.addColorStop(1, `${accent}33`);
    let phase = 0;
    let lastFrame = 0;

    const render = (now: number) => {
      if (animate) rafId = requestAnimationFrame(render);
      const elapsed = lastFrame ? now - lastFrame : 1000 / 30;
      if (elapsed < 1000 / 30 - 1) return;
      lastFrame = now;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      phase += Math.min(elapsed, 100) * 0.0048;

      for (let i = 0; i < bins; i++) {
        const beatWave =
          Math.sin(phase * 1.9 + i * 0.37) * 0.35 +
          Math.cos(phase * 3.1 - i * 0.21) * 0.28 +
          Math.sin(phase * 0.7 + i * 0.5) * 0.22;
        const target = animate
          ? Math.max(0.1, Math.min(0.95, 0.42 + beatWave * (1 - Math.abs(i - bins / 2) / bins)))
          : 0.08 + 0.04 * Math.sin(phase + i * 0.25);
        levels[i] = animate ? levels[i] + (target - levels[i]) * 0.38 : target;
      }

      if (activeStyle === 'bars') {
        const gap = 3;
        const barW = Math.max(2, (w - gap * (bins - 1)) / bins);
        ctx.fillStyle = barGradient;
        ctx.beginPath();
        for (let i = 0; i < bins; i++) {
          const barH = Math.max(3, levels[i] * (h - 6));
          const x = i * (barW + gap);
          const y = h - barH;
          ctx.roundRect(x, y, barW, barH, Math.min(4, barW / 2));
        }
        ctx.fill();
      } else if (activeStyle === 'wave') {
        ctx.beginPath();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = accent;
        for (let i = 0; i < bins; i++) {
          const x = (i / (bins - 1)) * w;
          const y = h / 2 + (levels[i] - 0.5) * h * 0.8 * (i % 2 === 0 ? 1 : -1);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        const cx = w / 2;
        const cy = h / 2;
        const baseR = Math.min(w, h) * 0.26;
        for (let i = 0; i < bins; i++) {
          const angle = (i / bins) * Math.PI * 2 + phase * 0.25;
          const r2 = baseR + levels[i] * Math.min(w, h) * 0.22;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * baseR, cy + Math.sin(angle) * baseR);
          ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
          ctx.stroke();
        }
      }

    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, [visualizerEnabled, activeStyle, animate, accent, height]);

  if (!visualizerEnabled) return null;

  return (
    <canvas
      ref={canvasRef}
      width={360}
      height={height}
      className={`w-full pointer-events-none ${className}`}
      style={{ height }}
    />
  );
});
