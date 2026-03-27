'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowPathIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';

import Button from '@/components/ui/button';
import { getTelegramControlStatus } from '@/lib/api';
import type { TelegramControlStatus } from '@/lib/types';

function statusClasses(status: TelegramControlStatus | null): string {
  if (!status) {
    return 'bg-slate-800 text-slate-300';
  }
  if (!status.enabled) {
    return 'bg-red-500/15 text-red-300';
  }
  if (status.polling_enabled && status.running) {
    return 'bg-emerald-500/15 text-emerald-300';
  }
  if (status.polling_enabled) {
    return 'bg-amber-500/15 text-amber-300';
  }
  return 'bg-cyan-500/15 text-cyan-200';
}

function statusLabel(status: TelegramControlStatus | null): string {
  if (!status) {
    return 'Checking Telegram';
  }
  if (!status.enabled) {
    return 'Not configured';
  }
  if (status.polling_enabled && status.running) {
    return 'Polling';
  }
  if (status.polling_enabled) {
    return 'Configured, not running';
  }
  return 'Webhook mode';
}

export default function TelegramControlCard() {
  const [status, setStatus] = useState<TelegramControlStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
    }
    try {
      const nextStatus = await getTelegramControlStatus();
      setStatus(nextStatus);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Telegram control status');
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
    const interval = window.setInterval(() => {
      void loadStatus(true);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [loadStatus]);

  const defaultProjectLabel = status?.default_project_name
    ? `${status.default_project_name} (${status.default_project_id})`
    : status?.default_project_id || 'unset';

  return (
    <div className="rounded-2xl border border-sky-500/20 bg-slate-950/70 px-5 py-4 backdrop-blur">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl bg-sky-500/10 p-2 text-sky-300">
              <ChatBubbleLeftRightIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Telegram Control</p>
              <p className="text-xs text-slate-400">
                Remote-control StudioOS workflow commands from Telegram using a project and scope aware chat session.
              </p>
            </div>
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClasses(status)}`}>
              {loading ? 'Checking Telegram' : statusLabel(status)}
            </span>
          </div>

          <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
            <div>
              <span className="text-slate-500">Default project:</span>{' '}
              <span className="text-slate-200">{defaultProjectLabel}</span>
            </div>
            <div>
              <span className="text-slate-500">Default scope:</span>{' '}
              <span className="text-slate-200">{status?.default_scope || 'general'}</span>
            </div>
            <div>
              <span className="text-slate-500">Allowed chats:</span>{' '}
              <span className="text-slate-200">{status ? status.allowed_chat_count || 'open' : 'checking'}</span>
            </div>
          </div>

          <div className="mt-2 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
            <div>
              Polling: <span className="text-slate-300">{status?.polling_enabled ? 'enabled' : 'disabled'}</span>
            </div>
            <div>
              Webhook secret:{' '}
              <span className="text-slate-300">{status?.webhook_secret_configured ? 'configured' : 'not set'}</span>
            </div>
            <div>
              Active chat sessions:{' '}
              <span className="text-slate-300">{status?.active_session_count ?? 0}</span>
            </div>
            <div>
              Default project resolved:{' '}
              <span className="text-slate-300">{status?.default_project_resolved ? 'yes' : 'no'}</span>
            </div>
          </div>

          {!status?.enabled ? (
            <p className="mt-3 text-xs text-slate-500">
              Configure <code className="rounded bg-slate-900 px-1 py-0.5 text-sky-300">TELEGRAM_BOT_TOKEN</code>,
              <code className="ml-1 rounded bg-slate-900 px-1 py-0.5 text-sky-300">TELEGRAM_DEFAULT_PROJECT_ID</code>,
              and optionally
              <code className="ml-1 rounded bg-slate-900 px-1 py-0.5 text-sky-300">TELEGRAM_ALLOWED_CHAT_IDS</code>
              in the repository root <code className="ml-1 rounded bg-slate-900 px-1 py-0.5 text-sky-300">.env</code>.
              Keep <code className="ml-1 rounded bg-slate-900 px-1 py-0.5 text-sky-300">backend/.env</code> only for
              backend-specific overrides.
            </p>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Use Telegram commands such as <code className="rounded bg-slate-900 px-1 py-0.5 text-sky-300">/projects</code>,
              <code className="ml-1 rounded bg-slate-900 px-1 py-0.5 text-sky-300">/project</code>,
              <code className="ml-1 rounded bg-slate-900 px-1 py-0.5 text-sky-300">/scope</code>, and plain-text tasks to
              drive StudioOS workflow commands remotely.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void loadStatus(true)}>
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>
    </div>
  );
}
