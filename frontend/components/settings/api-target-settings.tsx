'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import Button from '@/components/ui/button';
import {
  getApiHost,
  getApiHostOverride,
  getDefaultApiHost,
  getServerSafeDefaultApiHost,
  normalizeApiHost,
  readApiErrorMessage,
  setApiHostOverride,
} from '@/lib/api';
import type { HealthResponse } from '@/lib/types';

export default function ApiTargetSettings() {
  const [draftTarget, setDraftTarget] = useState('');
  const [activeTarget, setActiveTarget] = useState(getServerSafeDefaultApiHost());
  const [defaultTarget, setDefaultTarget] = useState(getServerSafeDefaultApiHost());
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  const syncTargets = useCallback(() => {
    setDraftTarget(getApiHostOverride() || '');
    setDefaultTarget(getDefaultApiHost());
    setActiveTarget(getApiHost());
  }, []);

  useEffect(() => {
    syncTargets();

    const handleStorage = () => syncTargets();
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [syncTargets]);

  const previewTarget = useMemo(() => {
    return draftTarget.trim() ? normalizeApiHost(draftTarget) : defaultTarget;
  }, [defaultTarget, draftTarget]);

  const hasOverride = draftTarget.trim().length > 0;

  const probeTarget = async (target: string) => {
    const response = await fetch(`${target}/api/v1/health`, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new Error(await readApiErrorMessage(response));
    }

    return response.json() as Promise<HealthResponse>;
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await probeTarget(previewTarget);
      setHealth(result);
      setSuccess(`Connected to ${previewTarget}`);
    } catch (err) {
      setHealth(null);
      setError(err instanceof Error ? err.message : 'Failed to reach API target');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const stored = setApiHostOverride(draftTarget || null);
      syncTargets();
      setSuccess(
        stored
          ? `Saved API target override: ${stored}`
          : `Cleared API target override. Using ${getDefaultApiHost()}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save API target');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setApiHostOverride(null);
    setDraftTarget('');
    setHealth(null);
    setError(null);
    setSuccess(`Cleared API target override. Using ${getDefaultApiHost()}`);
    syncTargets();
  };

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-rose-300">{error}</p>}
      {success && <p className="text-sm text-emerald-300">{success}</p>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <label className="block text-xs uppercase tracking-[0.18em] text-slate-500">API Target Override</label>
          <input
            type="text"
            value={draftTarget}
            onChange={(event) => setDraftTarget(event.target.value)}
            placeholder="Leave blank to use automatic target detection"
            suppressHydrationWarning
            className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <p className="mt-3 text-sm text-slate-400">
            Future frontend requests use this immediately. If blank, StudioOS falls back to
            <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">NEXT_PUBLIC_API_URL</code>
            or the current browser hostname on port
            <code className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">8000</code>.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={handleSave} loading={saving} suppressHydrationWarning>
              Save Target
            </Button>
            <Button variant="secondary" onClick={handleTest} loading={testing} suppressHydrationWarning>
              Test Connection
            </Button>
            <Button variant="ghost" onClick={handleReset} disabled={!hasOverride} suppressHydrationWarning>
              Reset To Default
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <Snapshot label="Active Target" value={activeTarget} accent="text-cyan-300" />
          <Snapshot label="Default Target" value={defaultTarget} />
          <Snapshot label="Preview Target" value={previewTarget} />
        </div>
      </div>

      {health && (
        <div className="rounded-2xl border border-emerald-800/60 bg-emerald-950/20 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-emerald-400">Health Probe</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Snapshot label="Status" value={health.status} accent="text-emerald-300" compact />
            <Snapshot label="Version" value={health.version} compact />
            <Snapshot label="Coordinator" value={health.coordinator} compact />
          </div>
          <p className="mt-3 text-sm text-slate-300">Domains: {health.domains.join(', ')}</p>
        </div>
      )}
    </div>
  );
}

function Snapshot({
  label,
  value,
  accent,
  compact = false,
}: {
  label: string;
  value: string;
  accent?: string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-950 ${compact ? 'p-3' : 'p-4'}`}>
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className={`mt-2 break-all font-mono text-sm ${accent || 'text-slate-200'}`}>{value}</p>
    </div>
  );
}
