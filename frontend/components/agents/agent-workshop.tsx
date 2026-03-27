'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  PlusIcon,
  TrashIcon,
  PencilIcon,
  WrenchScrewdriverIcon,
  PlayIcon,
  StopIcon,
} from '@heroicons/react/24/outline';
import { listAgents, createAgent, updateAgent, deleteAgent } from '@/lib/api';
import type { CustomAgent } from '@/lib/types';

function Badge({ text, color = 'slate' }: { text: string; color?: string }) {
  const colors: Record<string, string> = {
    slate: 'bg-slate-700 text-slate-300',
    green: 'bg-emerald-900/50 text-emerald-300',
    red: 'bg-red-900/50 text-red-300',
    cyan: 'bg-cyan-900/50 text-cyan-200',
    purple: 'bg-purple-900/50 text-purple-300',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[color] ?? colors.slate}`}>
      {text}
    </span>
  );
}

export default function AgentWorkshop() {
  const [agents, setAgents] = useState<CustomAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');

  /* Form state */
  const [formName, setFormName] = useState('');
  const [formDisplay, setFormDisplay] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formModel, setFormModel] = useState('google/gemini-2.5-flash');
  const [formTemp, setFormTemp] = useState(0.7);
  const [formMaxTok, setFormMaxTok] = useState(4096);
  const [formTools, setFormTools] = useState('');
  const [formExamples, setFormExamples] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = agents.find(a => a.id === selectedId) ?? null;

  /* ---------- Fetch ---------- */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAgents(await listAgents());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  /* ---------- Create ---------- */
  const handleCreate = useCallback(async () => {
    setError(null); setSaving(true);
    try {
      const a = await createAgent({
        name: formName,
        display_name: formDisplay,
        description: formDesc,
        system_prompt: formPrompt,
        model: formModel,
        temperature: formTemp,
        max_tokens: formMaxTok,
        tools: formTools.split(',').map(t => t.trim()).filter(Boolean),
        example_tasks: formExamples.split('\n').map(t => t.trim()).filter(Boolean),
      });
      setAgents(prev => [a, ...prev]);
      setSelectedId(a.id);
      setMode('list');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create agent');
    } finally {
      setSaving(false);
    }
  }, [formName, formDisplay, formDesc, formPrompt, formModel, formTemp, formMaxTok, formTools, formExamples]);

  /* ---------- Update ---------- */
  const handleUpdate = useCallback(async () => {
    if (!selectedId) return;
    setError(null); setSaving(true);
    try {
      const a = await updateAgent(selectedId, {
        display_name: formDisplay,
        description: formDesc,
        system_prompt: formPrompt,
        model: formModel,
        temperature: formTemp,
        max_tokens: formMaxTok,
        tools: formTools.split(',').map(t => t.trim()).filter(Boolean),
        example_tasks: formExamples.split('\n').map(t => t.trim()).filter(Boolean),
        is_active: formActive,
      });
      setAgents(prev => prev.map(x => x.id === a.id ? a : x));
      setMode('list');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update agent');
    } finally {
      setSaving(false);
    }
  }, [selectedId, formDisplay, formDesc, formPrompt, formModel, formTemp, formMaxTok, formTools, formExamples, formActive]);

  /* ---------- Delete ---------- */
  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteAgent(id);
      setAgents(prev => prev.filter(a => a.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch {
      /* ignore */
    }
  }, [selectedId]);

  /* ---------- Toggle active ---------- */
  const toggleActive = useCallback(async (agent: CustomAgent) => {
    try {
      const a = await updateAgent(agent.id, { is_active: !agent.is_active });
      setAgents(prev => prev.map(x => x.id === a.id ? a : x));
    } catch {
      /* ignore */
    }
  }, []);

  /* ---------- Open editor ---------- */
  const openCreate = () => {
    setFormName(''); setFormDisplay(''); setFormDesc(''); setFormPrompt('');
    setFormModel('google/gemini-2.5-flash'); setFormTemp(0.7); setFormMaxTok(4096);
    setFormTools(''); setFormExamples(''); setFormActive(true);
    setMode('create'); setError(null);
  };

  const openEdit = (a: CustomAgent) => {
    setSelectedId(a.id);
    setFormName(a.name); setFormDisplay(a.display_name); setFormDesc(a.description);
    setFormPrompt(a.system_prompt); setFormModel(a.model); setFormTemp(a.temperature);
    setFormMaxTok(a.max_tokens); setFormTools(a.tools.join(', '));
    setFormExamples(a.example_tasks.join('\n')); setFormActive(a.is_active);
    setMode('edit'); setError(null);
  };

  /* ================================================================ */
  /*  Render — Create / Edit form                                      */
  /* ================================================================ */
  if (mode === 'create' || mode === 'edit') {
    return (
      <div className="space-y-4">
        <button onClick={() => setMode('list')} className="text-sm text-slate-400 hover:text-white">&larr; Back to agents</button>
        <h2 className="text-xl font-bold text-white">{mode === 'create' ? 'New Agent' : 'Edit Agent'}</h2>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-slate-400">
            {mode === 'create' ? 'Name (snake_case, immutable)' : 'Name'}
            <input value={formName} onChange={e => setFormName(e.target.value)} disabled={mode === 'edit'}
              placeholder="my_custom_agent"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none disabled:opacity-50" />
          </label>
          <label className="block text-sm text-slate-400">Display Name
            <input value={formDisplay} onChange={e => setFormDisplay(e.target.value)} placeholder="My Custom Agent"
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
          </label>
        </div>

        <label className="block text-sm text-slate-400">Description
          <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2}
            className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
        </label>

        <label className="block text-sm text-slate-400">System Prompt
          <textarea value={formPrompt} onChange={e => setFormPrompt(e.target.value)} rows={8}
            placeholder="You are an expert at..."
            className="mt-1 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-green-300 focus:border-cyan-500 focus:outline-none" />
        </label>

        <div className="grid gap-4 md:grid-cols-3">
          <label className="block text-sm text-slate-400">Model
            <select value={formModel} onChange={e => setFormModel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none">
              <optgroup label="Google (direct API)">
                <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
                <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
                <option value="google/gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                <option value="google/gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                <option value="google/gemini-3-flash-preview">Gemini 3 Flash</option>
                <option value="google/gemini-2.0-flash">Gemini 2.0 Flash</option>
                <option value="google/gemini-2.0-flash-lite">Gemini 2.0 Flash Lite</option>
              </optgroup>
              <optgroup label="Free (via OpenRouter)">
                <option value="meta-llama/llama-3.3-70b-instruct:free">Llama 3.3 70B (free)</option>
                <option value="qwen/qwen3-coder:free">Qwen 3 Coder (free)</option>
                <option value="qwen/qwen3-235b-a22b:free">Qwen 3 235B (free)</option>
                <option value="mistralai/mistral-small-3.1-24b-instruct:free">Mistral Small 3.1 (free)</option>
                <option value="nousresearch/hermes-3-llama-3.1-405b:free">Hermes 3 405B (free)</option>
              </optgroup>
              <optgroup label="Ollama (local)">
                <option value="ollama/llama3.2">Llama 3.2 (3B)</option>
                <option value="ollama/llama3">Llama 3</option>
                <option value="ollama/mistral">Mistral</option>
                <option value="ollama/codellama">CodeLlama</option>
                <option value="ollama/phi3">Phi-3</option>
                <option value="ollama/gemma2">Gemma 2</option>
                <option value="ollama/qwen2">Qwen 2</option>
                <option value="ollama/deepseek-coder-v2">DeepSeek Coder v2</option>
              </optgroup>
            </select>
            <span className="mt-1 block text-[10px] text-slate-500">The router may override this based on task tier and strategy — see Settings.</span>
          </label>
          <label className="block text-sm text-slate-400">Temperature
            <input type="number" step="0.1" min="0" max="2" value={formTemp}
              onChange={e => setFormTemp(parseFloat(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
          </label>
          <label className="block text-sm text-slate-400">Max Tokens
            <input type="number" step="256" min="256" max="128000" value={formMaxTok}
              onChange={e => setFormMaxTok(parseInt(e.target.value) || 4096)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
          </label>
        </div>

        <label className="block text-sm text-slate-400">Tools / Capabilities (comma separated)
          <input value={formTools} onChange={e => setFormTools(e.target.value)}
            placeholder="web_search, code_execution, file_read"
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
        </label>

        <label className="block text-sm text-slate-400">Example Tasks (one per line)
          <textarea value={formExamples} onChange={e => setFormExamples(e.target.value)} rows={4}
            placeholder="Summarize the latest paper on CRISPR.&#10;Draft a lab report."
            className="mt-1 w-full resize-y rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
        </label>

        {mode === 'edit' && (
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={formActive} onChange={e => setFormActive(e.target.checked)}
              className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500" />
            Agent is active
          </label>
        )}

        <button disabled={saving || !formName || !formDisplay} onClick={mode === 'create' ? handleCreate : handleUpdate}
          className="rounded-lg bg-cyan-600 px-6 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50">
          {saving ? 'Saving…' : mode === 'create' ? 'Create Agent' : 'Save Changes'}
        </button>
      </div>
    );
  }

  /* ================================================================ */
  /*  Render — List view                                               */
  /* ================================================================ */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700">
          <PlusIcon className="h-4 w-4" /> New Agent
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading agents…</p>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
          <WrenchScrewdriverIcon className="mx-auto h-10 w-10 text-slate-600" />
          <p className="mt-2 text-sm text-slate-400">No custom agents yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map(a => (
            <div key={a.id}
              className={`rounded-xl border p-4 transition-colors cursor-pointer ${
                a.id === selectedId ? 'border-cyan-500/40 bg-cyan-900/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'
              }`}
              onClick={() => setSelectedId(a.id === selectedId ? null : a.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-white">{a.display_name}</h3>
                  <p className="mt-0.5 text-xs text-slate-500 font-mono">{a.name}</p>
                  {a.description && <p className="mt-1 line-clamp-2 text-xs text-slate-400">{a.description}</p>}
                </div>
                <Badge text={a.is_active ? 'active' : 'inactive'} color={a.is_active ? 'green' : 'red'} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge text={a.model.split('/').pop() ?? a.model} color="purple" />
                <Badge text={`temp ${a.temperature}`} />
                {a.tools.slice(0, 3).map(t => <Badge key={t} text={t} color="cyan" />)}
              </div>
              {a.id === selectedId && (
                <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3">
                  <button onClick={(e) => { e.stopPropagation(); openEdit(a); }}
                    className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600">
                    <PencilIcon className="h-3 w-3" /> Edit
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); toggleActive(a); }}
                    className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600">
                    {a.is_active ? <StopIcon className="h-3 w-3" /> : <PlayIcon className="h-3 w-3" />}
                    {a.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}
                    className="flex items-center gap-1 rounded bg-red-900/40 px-2 py-1 text-xs text-red-300 hover:bg-red-900/70">
                    <TrashIcon className="h-3 w-3" /> Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
