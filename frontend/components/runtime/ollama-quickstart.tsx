'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowPathIcon, CpuChipIcon } from '@heroicons/react/24/outline';
import Button from '@/components/ui/button';
import { getOllamaBootstrapStatus, startOllamaBootstrap } from '@/lib/api';
import type { OllamaBootstrapStatus } from '@/lib/types';

function statusClasses(status: OllamaBootstrapStatus | null): string {
  if (!status) {
    return 'bg-slate-800 text-slate-300';
  }
  if (status.connected && status.target_model_available) {
    return 'bg-emerald-500/15 text-emerald-300';
  }
  if (status.connected) {
    return 'bg-amber-500/15 text-amber-300';
  }
  if (status.state === 'running') {
    return 'bg-cyan-500/15 text-cyan-200';
  }
  return 'bg-red-500/15 text-red-300';
}

function statusLabel(status: OllamaBootstrapStatus | null): string {
  if (!status) {
    return 'Checking runtime';
  }
  if (status.connected && status.target_model_available) {
    return 'Connected';
  }
  if (status.connected) {
    return 'Connected, model missing';
  }
  if (status.state === 'running') {
    return 'Starting';
  }
  return 'Not connected';
}

export default function OllamaQuickstart({ showSettingsLink = true }: { showSettingsLink?: boolean }) {
  const [status, setStatus] = useState<OllamaBootstrapStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const nextStatus = await getOllamaBootstrapStatus();
      setStatus(nextStatus);
      setStarting(nextStatus.state === 'running');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Ollama runtime status');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status) {
      return undefined;
    }

    const intervalMs = status.state === 'running' ? 2500 : 15000;
    const interval = window.setInterval(() => {
      void loadStatus(true);
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [loadStatus, status]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const nextStatus = await startOllamaBootstrap(status?.model || undefined);
      setStatus(nextStatus);
      setStarting(nextStatus.state === 'running');
    } catch (err) {
      setStarting(false);
      setError(err instanceof Error ? err.message : 'Failed to start Ollama bootstrap');
    }
  };

  const latestMessage = status?.message || 'Start the local runtime to enable Ollama-backed autocomplete and workflow commands.';
  const readyModelCount = status?.available_models?.length || 0;

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-slate-950/70 px-5 py-4 backdrop-blur">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl bg-cyan-500/10 p-2 text-cyan-300">
              <CpuChipIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Local Ollama Runtime</p>
              <p className="text-xs text-slate-400">
                Start <code className="rounded bg-slate-900 px-1 py-0.5 text-cyan-300">ollama serve</code> and pull
                <code className="ml-1 rounded bg-slate-900 px-1 py-0.5 text-cyan-300">{status?.model || 'llama3'}</code> for local project-derived autofill and workflow commands.
              </p>
            </div>
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(status)}`}>
              {loading ? 'Checking runtime' : statusLabel(status)}
            </span>
          </div>

          <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
            <div>
              <span className="text-slate-500">Endpoint:</span>{' '}
              <span className="text-slate-200">{status?.base_url || 'http://localhost:11434'}</span>
            </div>
            <div>
              <span className="text-slate-500">Target model:</span>{' '}
              <span className="text-slate-200">{status?.model || 'llama3.2:3b'}</span>
            </div>
            <div>
              <span className="text-slate-500">Models ready:</span>{' '}
              <span className="text-slate-200">{readyModelCount}</span>
            </div>
          </div>

          <p className="mt-2 text-xs text-slate-500">{latestMessage}</p>
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleStart}
            loading={starting}
            className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"
          >
            {starting ? 'Bootstrapping Ollama…' : 'Start Local Runtime'}
          </Button>
          <Button variant="secondary" onClick={() => void loadStatus(true)}>
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </Button>
          {showSettingsLink && (
            <Link
              href="/settings"
              className="inline-flex items-center rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:text-white"
            >
              Runtime settings
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
