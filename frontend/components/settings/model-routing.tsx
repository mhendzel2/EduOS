'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getModelRoutingConfig,
  getOllamaBootstrapStatus,
  startOllamaBootstrap,
  updateModelRoutingConfig,
  type ModelRoutingConfig,
} from '@/lib/api';
import type { OllamaBootstrapStatus } from '@/lib/types';

const TIER_LABELS: Record<string, { label: string; desc: string }> = {
  reasoning:    { label: 'Reasoning',     desc: 'Deep analysis, multi-step logic, research review' },
  balanced:     { label: 'Balanced',      desc: 'Good quality at moderate cost / speed' },
  fast:         { label: 'Fast',          desc: 'Quick summaries, simple formatting' },
  code:         { label: 'Code',          desc: 'Code generation, debugging, pipelines' },
  long_context: { label: 'Long Context',  desc: 'Large documents (>50 k tokens)' },
};

const TIER_COLORS: Record<string, string> = {
  reasoning:    'border-purple-700 bg-purple-900/20',
  balanced:     'border-cyan-700 bg-cyan-900/20',
  fast:         'border-emerald-700 bg-emerald-900/20',
  code:         'border-amber-700 bg-amber-900/20',
  long_context: 'border-blue-700 bg-blue-900/20',
};

const STRATEGY_INFO: Record<string, { label: string; desc: string }> = {
  performance: { label: 'Performance', desc: 'Always pick the most capable model' },
  cost:        { label: 'Cost',        desc: 'Always pick the cheapest model (great for Ollama / local)' },
  balanced:    { label: 'Balanced',    desc: 'Maximize quality-per-dollar (default)' },
};

const PROVIDER_LABELS: Record<string, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI',
  ollama: 'Ollama (local)',
};

export default function ModelRoutingSettings() {
  const [config, setConfig] = useState<ModelRoutingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaBootstrapStatus | null>(null);

  // Local draft overrides
  const [agentOverrides, setAgentOverrides] = useState<Record<string, string>>({});
  const [tierOverrides, setTierOverrides] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState('balanced');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cfg, ollama] = await Promise.all([
        getModelRoutingConfig(),
        getOllamaBootstrapStatus().catch(() => null),
      ]);
      setConfig(cfg);
      setAgentOverrides(cfg.agent_overrides);
      setTierOverrides(cfg.tier_overrides);
      setStrategy(cfg.strategy || 'balanced');
      setOllamaStatus(ollama);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load routing config');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!ollamaStatus || ollamaStatus.state !== 'running') {
      return undefined;
    }

    const interval = window.setInterval(async () => {
      try {
        const status = await getOllamaBootstrapStatus();
        setOllamaStatus(status);
        setBootstrapping(status.state === 'running');
        if (status.state !== 'running') {
          window.clearInterval(interval);
          load();
        }
      } catch {
        window.clearInterval(interval);
      }
    }, 2500);

    return () => window.clearInterval(interval);
  }, [ollamaStatus, load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const cfg = await updateModelRoutingConfig({
        agent_overrides: Object.fromEntries(Object.entries(agentOverrides).filter(([, v]) => v)),
        tier_overrides: Object.fromEntries(Object.entries(tierOverrides).filter(([, v]) => v)),
        strategy,
      });
      setConfig(cfg);
      setAgentOverrides(cfg.agent_overrides);
      setTierOverrides(cfg.tier_overrides);
      setStrategy(cfg.strategy || 'balanced');
      setSuccess('Routing configuration saved');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleOllamaBootstrap = async () => {
    setError(null);
    setSuccess(null);
    setBootstrapping(true);
    try {
      const status = await startOllamaBootstrap('llama3.2:3b');
      setOllamaStatus(status);
      if (status.state !== 'running') {
        setBootstrapping(false);
      }
      setSuccess('Ollama bootstrap started');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setBootstrapping(false);
      setError(e instanceof Error ? e.message : 'Failed to start Ollama bootstrap');
    }
  };

  if (loading) return <p className="text-sm text-slate-500">Loading model routing…</p>;
  if (!config) return <p className="text-sm text-red-400">{error || 'Unable to load routing config'}</p>;

  const models = Array.isArray(config.supported_models) ? config.supported_models : [];
  const agentTierMap = (config.agent_tier_map || {}) as Record<string, string>;
  const agents = Object.keys(agentTierMap);
  const providers = Array.isArray(config.providers) ? config.providers : [];
  const costs = (config.model_costs || {}) as Record<string, { input: number; output: number }>;
  const strategies = Array.isArray(config.strategies) ? config.strategies : ['performance', 'cost', 'balanced'];
  const tiers = Array.isArray(config.tiers) ? config.tiers : [];
  const defaults = (config.defaults || {}) as Record<string, string[]>;

  const fmtCost = (model: string) => {
    const c = costs[model];
    if (!c) return '';
    if (c.input === 0 && c.output === 0) return 'free';
    return `$${(c.input + c.output).toFixed(4)}/1K`;
  };

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {success && <p className="text-sm text-emerald-400">{success}</p>}

      {/* Providers status */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Providers</h3>
        <p className="text-xs text-slate-500 mb-3">
          API keys are set via environment variables. The router tries providers in priority order.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {providers.map((p) => (
            <div
              key={p.name}
              className={`rounded-lg border p-3 ${
                p.configured
                  ? 'border-emerald-700/50 bg-emerald-900/10'
                  : 'border-slate-800 bg-slate-900 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">
                  {PROVIDER_LABELS[p.name] || p.name}
                </span>
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    p.configured
                      ? 'bg-emerald-900/50 text-emerald-300'
                      : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {p.configured ? 'configured' : 'no key'}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500 truncate">{p.base_url}</p>
              <p className="mt-1 text-[10px] text-slate-400">
                {p.models.length} model{p.models.length !== 1 ? 's' : ''}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-cyan-800/50 bg-cyan-950/30 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-white">Local Ollama Bootstrap</h3>
            <p className="text-xs text-slate-300">
              Starts <code className="rounded bg-slate-900 px-1.5 py-0.5 text-cyan-300">ollama serve</code> if needed and pulls
              <code className="ml-1 rounded bg-slate-900 px-1.5 py-0.5 text-cyan-300">llama3.2:3b</code>, which is the repo’s safest default for roughly 6 GB VRAM and 64 GB RAM.
            </p>
            <p className="text-[11px] text-slate-500">
              The button runs the local bootstrap script bundled with this repo. Use a larger Ollama model later only if you know your GPU headroom.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2">
            <button
              onClick={handleOllamaBootstrap}
              disabled={bootstrapping}
              className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-700 disabled:opacity-50"
            >
              {bootstrapping ? 'Bootstrapping Ollama…' : 'Start Ollama + Pull Llama 3.2 (3B)'}
            </button>
            {ollamaStatus && (
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                ollamaStatus.state === 'succeeded'
                  ? 'bg-emerald-900/50 text-emerald-300'
                  : ollamaStatus.state === 'failed'
                    ? 'bg-red-900/50 text-red-300'
                    : ollamaStatus.state === 'running'
                      ? 'bg-cyan-900/50 text-cyan-200'
                      : 'bg-slate-800 text-slate-400'
              }`}>
                {ollamaStatus.state}
              </span>
            )}
          </div>
        </div>

        {ollamaStatus && (
          <div className="mt-4 grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="space-y-2 text-xs text-slate-400">
              <div>
                <span className="text-slate-500">Model:</span>{' '}
                <span className="text-slate-200">{ollamaStatus.model}</span>
              </div>
              <div>
                <span className="text-slate-500">Started:</span>{' '}
                <span className="text-slate-200">{ollamaStatus.started_at || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">Completed:</span>{' '}
                <span className="text-slate-200">{ollamaStatus.completed_at || '—'}</span>
              </div>
              <div>
                <span className="text-slate-500">Latest:</span>{' '}
                <span className="text-slate-200">{ollamaStatus.message}</span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <p className="mb-2 text-xs font-semibold text-white">Bootstrap Log</p>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-slate-400">
                {ollamaStatus.log.length > 0 ? ollamaStatus.log.join('\n') : 'No bootstrap activity recorded yet.'}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Routing Strategy */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Routing Strategy</h3>
        <p className="text-xs text-slate-500 mb-3">
          Controls how the router picks among candidate models when no override is set.
        </p>
        <div className="flex flex-wrap gap-2">
          {strategies.map((s) => {
            const info = STRATEGY_INFO[s] || { label: s, desc: '' };
            const active = strategy === s;
            return (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={`rounded-lg border px-4 py-2 text-left transition-colors ${
                  active
                    ? 'border-cyan-500 bg-cyan-900/20 text-white'
                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600'
                }`}
              >
                <span className="block text-xs font-semibold">{info.label}</span>
                <span className="block text-[10px] text-slate-500 mt-0.5">{info.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tier defaults + overrides */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Tier Defaults</h3>
        <p className="text-xs text-slate-500 mb-3">
          Each tier has a default model. Override to route an entire capability class to a different model.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tiers.map((tier) => {
            const meta = TIER_LABELS[tier] || { label: tier, desc: '' };
            const tierDefaults = defaults[tier] || [];
            return (
              <div key={tier} className={`rounded-xl border p-3 ${TIER_COLORS[tier] || 'border-slate-700 bg-slate-900'}`}>
                <p className="text-xs font-semibold text-white">{meta.label}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{meta.desc}</p>
                <p className="mt-1.5 text-[10px] text-slate-500">
                  Default: <span className="text-slate-300">{tierDefaults[0] || '—'}</span>
                  {tierDefaults.length > 1 && <span className="text-slate-500"> (+{tierDefaults.length - 1} fallbacks)</span>}
                </p>
                <select
                  aria-label={`Override model for ${meta.label} tier`}
                  value={tierOverrides[tier] || ''}
                  onChange={(e) => setTierOverrides((prev) => ({ ...prev, [tier]: e.target.value }))}
                  className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                >
                  <option value="">Use default ({tierDefaults[0]})</option>
                  {models.map((m) => (
                    <option key={m} value={m}>{m}{fmtCost(m) ? ` (${fmtCost(m)})` : ''}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-agent overrides */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-3">Per-Agent Overrides</h3>
        <p className="text-xs text-slate-500 mb-3">
          Pin a specific agent to a model, bypassing its tier assignment.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="pb-2 pr-4 font-medium">Agent</th>
                <th className="pb-2 pr-4 font-medium">Default Tier</th>
                <th className="pb-2 font-medium">Override Model</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const tier = agentTierMap[agent];
                const tierMeta = TIER_LABELS[tier] || { label: tier };
                return (
                  <tr key={agent} className="border-b border-slate-800/50">
                    <td className="py-2 pr-4 font-mono text-slate-200">{agent}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        tier === 'reasoning' ? 'bg-purple-900/50 text-purple-300' :
                        tier === 'code' ? 'bg-amber-900/50 text-amber-300' :
                        tier === 'fast' ? 'bg-emerald-900/50 text-emerald-300' :
                        'bg-cyan-900/50 text-cyan-200'
                      }`}>
                        {tierMeta.label}
                      </span>
                    </td>
                    <td className="py-2">
                      <select
                        aria-label={`Override model for ${agent} agent`}
                        value={agentOverrides[agent] || ''}
                        onChange={(e) => setAgentOverrides((prev) => ({ ...prev, [agent]: e.target.value }))}
                        className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="">Use tier default</option>
                        {models.map((m) => (
                          <option key={m} value={m}>{m}{fmtCost(m) ? ` (${fmtCost(m)})` : ''}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-cyan-600 px-5 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Routing Config'}
        </button>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
