'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  PlusIcon,
  TrashIcon,
  PencilIcon,
  ArrowUpTrayIcon,
  CodeBracketIcon,
  FunnelIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { listScripts, createScript, updateScript, deleteScript, importScript } from '@/lib/api';
import type { Script } from '@/lib/types';

/* ------------------------------------------------------------------ */
/*  Sub‑components                                                      */
/* ------------------------------------------------------------------ */
function Badge({ text, color = 'slate' }: { text: string; color?: string }) {
  const colors: Record<string, string> = {
    slate: 'bg-slate-700 text-slate-300',
    green: 'bg-emerald-900/50 text-emerald-300',
    yellow: 'bg-yellow-900/50 text-yellow-300',
    blue: 'bg-blue-900/50 text-blue-300',
    red: 'bg-red-900/50 text-red-300',
    cyan: 'bg-cyan-900/50 text-cyan-200',
  };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${colors[color] ?? colors.slate}`}>
      {text}
    </span>
  );
}

const LIFECYCLE_COLORS: Record<string, string> = {
  draft: 'yellow',
  review_required: 'blue',
  approved: 'green',
  executed: 'cyan',
  failed: 'red',
};

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */
export default function ScriptLibrary() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterLang, setFilterLang] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'create' | 'edit' | 'import'>('list');

  /* Form state */
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formLang, setFormLang] = useState<'python' | 'r'>('python');
  const [formCode, setFormCode] = useState('');
  const [formTags, setFormTags] = useState('');
  const [formLifecycle, setFormLifecycle] = useState('draft');

  /* Import-specific */
  const [importCode, setImportCode] = useState('');
  const [importPath, setImportPath] = useState('');
  const [importAck, setImportAck] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = scripts.find(s => s.id === selectedId) ?? null;

  /* ---------- Fetch ---------- */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listScripts(undefined, filterLang || undefined);
      setScripts(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filterLang]);

  useEffect(() => { refresh(); }, [refresh]);

  /* ---------- Create ---------- */
  const handleCreate = useCallback(async () => {
    setError(null); setSaving(true);
    try {
      const s = await createScript({
        title: formTitle,
        description: formDesc,
        language: formLang,
        code: formCode,
        tags: formTags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setScripts(prev => [s, ...prev]);
      setSelectedId(s.id);
      setMode('list');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create script');
    } finally {
      setSaving(false);
    }
  }, [formTitle, formDesc, formLang, formCode, formTags]);

  /* ---------- Update ---------- */
  const handleUpdate = useCallback(async () => {
    if (!selectedId) return;
    setError(null); setSaving(true);
    try {
      const s = await updateScript(selectedId, {
        title: formTitle,
        description: formDesc,
        language: formLang,
        code: formCode,
        tags: formTags.split(',').map(t => t.trim()).filter(Boolean),
        lifecycle_state: formLifecycle,
      });
      setScripts(prev => prev.map(x => x.id === s.id ? s : x));
      setMode('list');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update script');
    } finally {
      setSaving(false);
    }
  }, [selectedId, formTitle, formDesc, formLang, formCode, formTags, formLifecycle]);

  /* ---------- Delete ---------- */
  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteScript(id);
      setScripts(prev => prev.filter(s => s.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch {
      /* ignore */
    }
  }, [selectedId]);

  /* ---------- Import ---------- */
  const handleImport = useCallback(async () => {
    setError(null); setSaving(true);
    try {
      const s = await importScript({
        title: formTitle,
        description: formDesc,
        language: formLang,
        code: importCode,
        tags: formTags.split(',').map(t => t.trim()).filter(Boolean),
        source_path: importPath || undefined,
        safety_acknowledged: importAck,
      });
      setScripts(prev => [s, ...prev]);
      setSelectedId(s.id);
      setMode('list');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to import script');
    } finally {
      setSaving(false);
    }
  }, [formTitle, formDesc, formLang, importCode, formTags, importPath, importAck]);

  /* ---------- Open editor ---------- */
  const openCreate = () => {
    setFormTitle(''); setFormDesc(''); setFormLang('python'); setFormCode(''); setFormTags('');
    setMode('create');
    setError(null);
  };

  const openEdit = (s: Script) => {
    setSelectedId(s.id);
    setFormTitle(s.title); setFormDesc(s.description); setFormLang(s.language as 'python' | 'r');
    setFormCode(s.code); setFormTags(s.tags.join(', ')); setFormLifecycle(s.lifecycle_state);
    setMode('edit');
    setError(null);
  };

  const openImport = () => {
    setFormTitle(''); setFormDesc(''); setFormLang('python'); setFormTags('');
    setImportCode(''); setImportPath(''); setImportAck(false);
    setMode('import');
    setError(null);
  };

  /* ---------- File upload for import ---------- */
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setImportCode(reader.result as string);
      if (!formTitle) setFormTitle(file.name.replace(/\.(py|r|R)$/, ''));
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'r') setFormLang('r');
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [formTitle]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  if (mode === 'create' || mode === 'edit') {
    return (
      <div className="space-y-4">
        <button onClick={() => setMode('list')} className="text-sm text-slate-400 hover:text-white">&larr; Back to library</button>
        <h2 className="text-xl font-bold text-white">{mode === 'create' ? 'New Script' : 'Edit Script'}</h2>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-slate-400">Title
            <input value={formTitle} onChange={e => setFormTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
          </label>
          <label className="block text-sm text-slate-400">Language
            <select value={formLang} onChange={e => setFormLang(e.target.value as 'python' | 'r')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none">
              <option value="python">Python</option>
              <option value="r">R</option>
            </select>
          </label>
        </div>
        <label className="block text-sm text-slate-400">Description
          <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2} className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
        </label>
        <label className="block text-sm text-slate-400">Tags (comma separated)
          <input value={formTags} onChange={e => setFormTags(e.target.value)} placeholder="pca, rna-seq" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
        </label>
        {mode === 'edit' && (
          <label className="block text-sm text-slate-400">Lifecycle State
            <select value={formLifecycle} onChange={e => setFormLifecycle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none">
              <option value="draft">Draft</option>
              <option value="review_required">Review Required</option>
              <option value="approved">Approved</option>
              <option value="executed">Executed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
        )}
        <label className="block text-sm text-slate-400">Code
          <textarea value={formCode} onChange={e => setFormCode(e.target.value)} rows={16} spellCheck={false} className="mt-1 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-green-300 focus:border-cyan-500 focus:outline-none" />
        </label>
        <button disabled={saving || !formTitle} onClick={mode === 'create' ? handleCreate : handleUpdate}
          className="rounded-lg bg-cyan-600 px-6 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-50">
          {saving ? 'Saving…' : mode === 'create' ? 'Create Script' : 'Save Changes'}
        </button>
      </div>
    );
  }

  if (mode === 'import') {
    return (
      <div className="space-y-4">
        <button onClick={() => setMode('list')} className="text-sm text-slate-400 hover:text-white">&larr; Back to library</button>
        <h2 className="text-xl font-bold text-white">Import Script</h2>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="rounded-lg border border-yellow-700 bg-yellow-900/20 p-4">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="h-6 w-6 flex-shrink-0 text-yellow-400" />
            <div className="text-sm text-yellow-200">
              <p className="font-semibold">Security Warning</p>
              <p className="mt-1">Imported scripts may execute arbitrary code. Only import scripts from trusted sources. You must verify the code before running it.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm text-slate-400">Title
            <input value={formTitle} onChange={e => setFormTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
          </label>
          <label className="block text-sm text-slate-400">Language
            <select value={formLang} onChange={e => setFormLang(e.target.value as 'python' | 'r')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none">
              <option value="python">Python</option>
              <option value="r">R</option>
            </select>
          </label>
        </div>
        <label className="block text-sm text-slate-400">Description
          <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={2} className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
        </label>
        <label className="block text-sm text-slate-400">Tags (comma separated)
          <input value={formTags} onChange={e => setFormTags(e.target.value)} placeholder="imported, rna-seq" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
        </label>
        <label className="block text-sm text-slate-400">Source Path (optional)
          <input value={importPath} onChange={e => setImportPath(e.target.value)} placeholder="/path/to/script.py" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none" />
        </label>

        <div>
          <label className="block text-sm text-slate-400 mb-1">Upload a file or paste code below</label>
          <input type="file" accept=".py,.r,.R" onChange={handleFileUpload} className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-slate-600" />
        </div>

        <label className="block text-sm text-slate-400">Code
          <textarea value={importCode} onChange={e => setImportCode(e.target.value)} rows={14} spellCheck={false} className="mt-1 w-full resize-y rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-green-300 focus:border-cyan-500 focus:outline-none" />
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={importAck} onChange={e => setImportAck(e.target.checked)} className="rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-cyan-500" />
          I acknowledge the security risks and have reviewed this code
        </label>

        <button disabled={saving || !formTitle || !importCode || !importAck} onClick={handleImport}
          className="rounded-lg bg-yellow-600 px-6 py-2 text-sm font-medium text-white hover:bg-yellow-700 disabled:opacity-50">
          {saving ? 'Importing…' : 'Import Script'}
        </button>
      </div>
    );
  }

  /* ---------- List view ---------- */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={openCreate} className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700">
          <PlusIcon className="h-4 w-4" /> New Script
        </button>
        <button onClick={openImport} className="flex items-center gap-1.5 rounded-lg border border-yellow-700 bg-yellow-900/30 px-4 py-2 text-sm font-medium text-yellow-200 hover:bg-yellow-900/50">
          <ArrowUpTrayIcon className="h-4 w-4" /> Import Script
        </button>
        <div className="ml-auto flex items-center gap-2">
          <FunnelIcon className="h-4 w-4 text-slate-500" />
          <select value={filterLang} onChange={e => setFilterLang(e.target.value)}
            aria-label="Filter by language"
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 focus:border-cyan-500 focus:outline-none">
            <option value="">All Languages</option>
            <option value="python">Python</option>
            <option value="r">R</option>
          </select>
        </div>
      </div>

      {/* Script grid */}
      {loading ? (
        <p className="text-sm text-slate-500">Loading scripts…</p>
      ) : scripts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
          <CodeBracketIcon className="mx-auto h-10 w-10 text-slate-600" />
          <p className="mt-2 text-sm text-slate-400">No scripts yet. Create one or import an existing file.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {scripts.map(s => (
            <div key={s.id}
              className={`rounded-xl border p-4 transition-colors cursor-pointer ${
                s.id === selectedId ? 'border-cyan-500/40 bg-cyan-900/10' : 'border-slate-800 bg-slate-900 hover:border-slate-700'
              }`}
              onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-white">{s.title}</h3>
                  {s.description && <p className="mt-0.5 line-clamp-2 text-xs text-slate-400">{s.description}</p>}
                </div>
                <Badge text={s.language} color={s.language === 'python' ? 'blue' : 'green'} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge text={s.lifecycle_state.replace('_', ' ')} color={LIFECYCLE_COLORS[s.lifecycle_state] ?? 'slate'} />
                {s.source_type === 'imported' && <Badge text="imported" color="yellow" />}
                {s.tags.slice(0, 3).map(t => <Badge key={t} text={t} />)}
              </div>
              {s.id === selectedId && (
                <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3">
                  <button onClick={(e) => { e.stopPropagation(); openEdit(s); }} className="flex items-center gap-1 rounded bg-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-600">
                    <PencilIcon className="h-3 w-3" /> Edit
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }} className="flex items-center gap-1 rounded bg-red-900/40 px-2 py-1 text-xs text-red-300 hover:bg-red-900/70">
                    <TrashIcon className="h-3 w-3" /> Delete
                  </button>
                  {s.lifecycle_state === 'approved' && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-400">
                      <CheckCircleIcon className="h-3.5 w-3.5" /> Ready to run
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
