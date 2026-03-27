'use client';

import { useEffect, useState } from 'react';
import { getApiBaseUrl, readApiErrorMessage } from '@/lib/api';

export default function SecurityModeSettings() {
  const [mode, setMode] = useState<string>('MODE_A');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchMode() {
      try {
        const res = await fetch(`${getApiBaseUrl()}/config/security-mode`);
        if (!res.ok) throw new Error(await readApiErrorMessage(res));
        const data = await res.json();
        setMode(data.mode || 'MODE_A');
      } catch (err: unknown) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Could not load current security mode. Is the backend running?');
      } finally {
        setLoading(false);
      }
    }
    fetchMode();
  }, []);

  async function handleToggle(newMode: string) {
    if (newMode === mode) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBaseUrl()}/config/security-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res));
      const data = await res.json();
      setMode(data.mode);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to update security mode');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-slate-400 text-sm">Loading security configuration...</div>;

  return (
    <div className="space-y-4">
      {error && <div className="text-red-400 text-sm">{error}</div>}
      
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={() => handleToggle('MODE_A')}
          disabled={saving}
          className={`flex-1 rounded-2xl border text-left p-4 transition-all ${
            mode === 'MODE_A'
              ? 'border-cyan-500 bg-cyan-950/20 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/50'
              : 'border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className={`font-semibold ${mode === 'MODE_A' ? 'text-cyan-400' : 'text-slate-200'}`}>
              Mode A: Personal Workstation
            </h3>
            {mode === 'MODE_A' && <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></span>}
          </div>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            Low friction environment. Assumes OS login/encrypted disk. Minimal auditing.
            Explicit opt-in required for cloud model calls per agent/tier.
          </p>
        </button>

        <button
          onClick={() => handleToggle('MODE_C')}
          disabled={saving}
          className={`flex-1 rounded-2xl border text-left p-4 transition-all ${
            mode === 'MODE_C'
              ? 'border-indigo-500 bg-indigo-950/20 shadow-[0_0_15px_rgba(99,102,241,0.15)] ring-1 ring-indigo-500/50'
              : 'border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/40'
          }`}
        >
          <div className="flex items-center justify-between">
            <h3 className={`font-semibold ${mode === 'MODE_C' ? 'text-indigo-400' : 'text-slate-200'}`}>
              Mode C: High Controls
            </h3>
            {mode === 'MODE_C' && <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]"></span>}
          </div>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            Regulated single-user context. Enables DB encryption-at-rest for sensitive tables,
            blocks cloud models by default (forces Ollama fallback).
          </p>
        </button>
      </div>

      {saving && <p className="text-sm text-slate-500 animate-pulse">Saving changes...</p>}
      <p className="text-xs text-slate-500 mt-2">
        Note: Changes may require a backend restart to fully apply (e.g. DB engine re-init for encryption).
      </p>
    </div>
  );
}
