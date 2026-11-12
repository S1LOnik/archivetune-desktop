import React, { useEffect, useState } from 'react';
import { X, Activity, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useUIStore } from '../store';
import type { AcousticAuditResult } from '../types/electron';

export default function AcousticAuditModal() {
  const { auditTarget, setAuditTarget } = useUIStore();
  const [result, setResult] = useState<AcousticAuditResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!auditTarget) return;
    setLoading(true);
    setResult(null);
    window.electronAPI?.player
      ?.auditQuality?.(auditTarget.urlOrPath)
      .then((res) => setResult(res))
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, [auditTarget]);

  if (!auditTarget) return null;

  const isLosslessOk = result?.verdict === 'VERIFIED_LOSSLESS';
  const isFake = result?.verdict === 'SUSPECTED_TRANSCODE';

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
      onClick={() => setAuditTarget(null)}
    >
      <div
        className="w-full max-w-lg bg-surface-container border border-outline-variant/40 rounded-3xl shadow-2xl p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-on-surface flex items-center gap-2">
              <Activity size={18} className="text-primary" />
              Acoustic Quality Auditor (FFT 4096)
            </h2>
            <p className="text-xs text-on-surface-variant mt-0.5 truncate max-w-sm">
              {auditTarget.track.title} — {auditTarget.track.artist}
            </p>
          </div>
          <button
            onClick={() => setAuditTarget(null)}
            className="p-1.5 rounded-xl hover:bg-surface-container-high text-on-surface-variant"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-on-surface-variant">
            Декодирование PCM сегмента и расчёт спектрального cutoff...
          </div>
        ) : !result ? (
          <div className="py-8 text-center text-sm text-on-surface-variant">
            Не удалось выполнить FFT-анализ активного потока.
          </div>
        ) : (
          <div className="space-y-4">
            <div
              className={`p-4 rounded-2xl border flex items-center gap-3 ${
                isLosslessOk
                  ? 'bg-emerald-500/10 border-emerald-400/35 text-emerald-200'
                  : isFake
                  ? 'bg-amber-500/15 border-amber-400/40 text-amber-200'
                  : 'bg-surface-container-high border-outline-variant/30 text-on-surface'
              }`}
            >
              {isFake ? (
                <AlertTriangle size={22} className="text-amber-300 flex-shrink-0" />
              ) : (
                <ShieldCheck
                  size={22}
                  className={isLosslessOk ? 'text-emerald-300 flex-shrink-0' : 'text-primary flex-shrink-0'}
                />
              )}
              <div>
                <div className="text-sm font-bold">{result.verdict.replace(/_/g, ' ')}</div>
                <div className="text-xs opacity-90 mt-0.5">{result.summary}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-2xl bg-surface-container-high">
                <div className="text-on-surface-variant">Кодек / Контейнер</div>
                <div className="text-sm font-bold text-on-surface mt-0.5">
                  {result.codec.toUpperCase()} {result.declaredLossless ? '(Lossless)' : '(Lossy)'}
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-surface-container-high">
                <div className="text-on-surface-variant">Sample Rate / Depth</div>
                <div className="text-sm font-bold text-on-surface mt-0.5">
                  {result.sampleRate ? `${(result.sampleRate / 1000).toFixed(1)} kHz` : '—'} •{' '}
                  {result.bitDepth || 16}-bit
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-surface-container-high">
                <div className="text-on-surface-variant">Спектральный Cutoff</div>
                <div className="text-sm font-bold text-on-surface mt-0.5">
                  {(result.cutoffHz / 1000).toFixed(2)} kHz
                </div>
              </div>
              <div className="p-3 rounded-2xl bg-surface-container-high">
                <div className="text-on-surface-variant">Битрейт / Roll-Off</div>
                <div className="text-sm font-bold text-on-surface mt-0.5">
                  {result.bitrateKbps || '—'} kbps • {(result.rollOffHz / 1000).toFixed(1)} kHz
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
