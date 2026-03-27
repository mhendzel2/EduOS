'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowPathIcon,
  EnvelopeIcon,
  EnvelopeOpenIcon,
  ExclamationTriangleIcon,
  FlagIcon,
  FunnelIcon,
  PaperAirplaneIcon,
  SparklesIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import {
  listEmails,
  fetchNewEmails,
  markEmailRead,
  flagEmail,
  triageEmail,
  triageBatch,
  getEmailConfigStatus,
  getEmailUnreadCount,
  type Email,
} from '@/lib/api';

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  normal: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  low: 'bg-slate-700/20 text-slate-500 border-slate-700/30',
};

const CATEGORY_BADGES: Record<string, string> = {
  action_required: 'bg-red-900/40 text-red-300',
  meeting: 'bg-purple-900/40 text-purple-300',
  finance: 'bg-green-900/40 text-green-300',
  project: 'bg-blue-900/40 text-blue-300',
  social: 'bg-pink-900/40 text-pink-300',
  newsletter: 'bg-slate-800 text-slate-400',
  spam: 'bg-slate-800 text-slate-500',
  other: 'bg-slate-800 text-slate-400',
};

export default function InboxPanel() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selected, setSelected] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical' | 'high'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Parameters<typeof listEmails>[0] = { limit: 100 };
      if (filter === 'unread') params.unread_only = true;
      if (filter === 'critical') params.priority = 'critical';
      if (filter === 'high') params.priority = 'high';
      const [list, status, unread] = await Promise.all([
        listEmails(params),
        getEmailConfigStatus(),
        getEmailUnreadCount(),
      ]);
      setEmails(list);
      setConfigured(status.configured);
      setUnreadCount(unread.count);
    } catch {
      // API might not be available yet
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleFetch = async () => {
    setFetching(true);
    try {
      await fetchNewEmails();
      await load();
    } finally {
      setFetching(false);
    }
  };

  const handleTriageAll = async () => {
    setTriaging(true);
    try {
      await triageBatch();
      await load();
    } finally {
      setTriaging(false);
    }
  };

  const handleSelect = async (em: Email) => {
    setSelected(em);
    if (!em.is_read) {
      const updated = await markEmailRead(em.id);
      setEmails((prev) => prev.map((e) => (e.id === em.id ? updated : e)));
      setSelected(updated);
      setUnreadCount((c) => Math.max(0, c - 1));
    }
  };

  const handleFlag = async (em: Email) => {
    const updated = await flagEmail(em.id, !em.is_flagged);
    setEmails((prev) => prev.map((e) => (e.id === em.id ? updated : e)));
    if (selected?.id === em.id) setSelected(updated);
  };

  const handleTriageOne = async (em: Email) => {
    const updated = await triageEmail(em.id);
    setEmails((prev) => prev.map((e) => (e.id === em.id ? updated : e)));
    if (selected?.id === em.id) setSelected(updated);
  };

  if (configured === false) {
    return (
      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-8 text-center">
        <EnvelopeIcon className="mx-auto h-12 w-12 text-slate-500" />
        <h3 className="mt-4 text-lg font-semibold text-white">Email Not Configured</h3>
        <p className="mt-2 text-sm text-slate-400">
          Set <code className="rounded bg-slate-700 px-1">EMAIL_IMAP_HOST</code>,{' '}
          <code className="rounded bg-slate-700 px-1">EMAIL_ADDRESS</code>, and{' '}
          <code className="rounded bg-slate-700 px-1">EMAIL_PASSWORD</code> in your <code className="rounded bg-slate-700 px-1">.env</code> file to enable
          email integration.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-4">
      {/* Email list */}
      <div className="flex w-96 flex-col rounded-xl border border-slate-700 bg-slate-800/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 p-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">Inbox</h3>
            {unreadCount > 0 && (
              <span className="rounded-full bg-cyan-500 px-2 py-0.5 text-xs font-bold text-slate-950">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={handleFetch}
              disabled={fetching}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50"
              title="Fetch new emails"
            >
              <ArrowPathIcon className={`h-4 w-4 ${fetching ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={handleTriageAll}
              disabled={triaging}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-50"
              title="AI triage all unprocessed"
            >
              <SparklesIcon className={`h-4 w-4 ${triaging ? 'animate-pulse' : ''}`} />
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex gap-1 border-b border-slate-700 p-2">
          {(['all', 'unread', 'critical', 'high'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                filter === f
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Email list */}
        <ul className="flex-1 overflow-y-auto">
          {loading ? (
            <li className="p-4 text-center text-sm text-slate-500">Loading…</li>
          ) : emails.length === 0 ? (
            <li className="p-4 text-center text-sm text-slate-500">No emails</li>
          ) : (
            emails.map((em) => (
              <li
                key={em.id}
                onClick={() => handleSelect(em)}
                className={`cursor-pointer border-b border-slate-700/50 p-3 transition-colors hover:bg-slate-700/50 ${
                  selected?.id === em.id ? 'bg-slate-700/70' : ''
                } ${!em.is_read ? 'border-l-2 border-l-cyan-500' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm ${em.is_read ? 'text-slate-300' : 'font-semibold text-white'}`}>
                      {em.subject || '(no subject)'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-slate-500">{em.sender}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {em.date && (
                      <span className="whitespace-nowrap text-[10px] text-slate-500">
                        {new Date(em.date).toLocaleDateString()}
                      </span>
                    )}
                    {em.priority && (
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${PRIORITY_COLORS[em.priority] || ''}`}>
                        {em.priority}
                      </span>
                    )}
                  </div>
                </div>
                {em.ai_summary && (
                  <p className="mt-1 truncate text-xs text-slate-400">{em.ai_summary}</p>
                )}
                <div className="mt-1 flex gap-1">
                  {em.ai_category && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${CATEGORY_BADGES[em.ai_category] || CATEGORY_BADGES.other}`}>
                      {em.ai_category.replace('_', ' ')}
                    </span>
                  )}
                  {em.needs_response && (
                    <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                      needs reply
                    </span>
                  )}
                  {em.is_flagged && <FlagIcon className="h-3 w-3 text-yellow-500" />}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>

      {/* Email detail */}
      <div className="flex flex-1 flex-col rounded-xl border border-slate-700 bg-slate-800/50">
        {selected ? (
          <>
            <div className="border-b border-slate-700 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selected.subject || '(no subject)'}</h2>
                  <p className="mt-1 text-sm text-slate-400">From: {selected.sender}</p>
                  {selected.date && (
                    <p className="text-xs text-slate-500">
                      {new Date(selected.date).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleFlag(selected)}
                    className={`rounded-lg p-2 ${
                      selected.is_flagged
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                    }`}
                    title="Toggle flag"
                  >
                    <FlagIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleTriageOne(selected)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white"
                    title="AI triage this email"
                  >
                    <SparklesIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* AI triage info */}
              {selected.triaged_at && (
                <div className="mt-3 rounded-lg border border-slate-600 bg-slate-900/50 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-cyan-300">
                    <SparklesIcon className="h-3.5 w-3.5" />
                    AI Triage
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500">Priority:</span>{' '}
                      <span className={`rounded-full border px-1.5 py-0.5 ${PRIORITY_COLORS[selected.priority || ''] || ''}`}>
                        {selected.priority}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500">Category:</span>{' '}
                      <span className={`rounded px-1.5 py-0.5 ${CATEGORY_BADGES[selected.ai_category || ''] || CATEGORY_BADGES.other}`}>
                        {selected.ai_category?.replace('_', ' ')}
                      </span>
                    </div>
                    {selected.needs_response && (
                      <div className="col-span-2 flex items-center gap-1 text-amber-300">
                        <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                        Response needed
                      </div>
                    )}
                    {selected.suggested_action && (
                      <div className="col-span-2">
                        <span className="text-slate-500">Suggested action:</span>{' '}
                        <span className="text-slate-300">{selected.suggested_action}</span>
                      </div>
                    )}
                  </div>
                  {selected.ai_summary && (
                    <p className="mt-2 text-xs text-slate-300">{selected.ai_summary}</p>
                  )}
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-sm text-slate-300">
                {selected.body_text || '(empty)'}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            <div className="text-center">
              <EnvelopeOpenIcon className="mx-auto h-10 w-10" />
              <p className="mt-2 text-sm">Select an email to view</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
