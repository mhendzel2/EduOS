'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import Button from '@/components/ui/button';
import {
  createPromptFeedback,
  createPromptTemplate,
  listProjects,
  listPromptFeedback,
  listPromptTemplates,
  optimizePromptTemplate,
  updatePromptTemplate,
} from '@/lib/api';
import type {
  PromptFeedback,
  PromptOptimizationResult,
  PromptTemplate,
  PromptTemplateFeedbackSummary,
  StudioProject,
} from '@/lib/types';

const EMPTY_FORM = {
  id: '',
  project_id: '',
  name: '',
  category: 'brand_autocomplete',
  target_kind: 'brand_bible',
  description: '',
  system_prompt: '',
  user_prompt_template: '',
  tags: 'brand, autocomplete',
  metadata: '{}',
};

const EMPTY_FEEDBACK_FORM = {
  score: '3',
  would_reuse: '',
  use_case: '',
  strengths: '',
  failure_modes: '',
  notes: '',
  task_input: '',
  output_excerpt: '',
};

export default function PromptLibraryPage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'project'>('all');
  const [projectFilterId, setProjectFilterId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [feedbackForm, setFeedbackForm] = useState(EMPTY_FEEDBACK_FORM);
  const [feedbackSummary, setFeedbackSummary] = useState<PromptTemplateFeedbackSummary | null>(null);
  const [feedbackItems, setFeedbackItems] = useState<PromptFeedback[]>([]);
  const [optimizationGoal, setOptimizationGoal] = useState('');
  const [variantName, setVariantName] = useState('');
  const [optimizationResult, setOptimizationResult] = useState<PromptOptimizationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId) || null,
    [prompts, selectedPromptId]
  );

  const refresh = async (nextProjectId?: string) => {
    setLoading(true);
    setError('');
    try {
      const [projectData, promptData] = await Promise.all([
        listProjects(),
        listPromptTemplates({ projectId: nextProjectId || projectFilterId || undefined }),
      ]);
      setProjects(projectData.projects);
      setPrompts(promptData.prompts);

      if (!selectedPromptId && promptData.prompts[0]) {
        selectPrompt(promptData.prompts[0]);
      } else if (selectedPromptId) {
        const refreshedSelected = promptData.prompts.find((prompt) => prompt.id === selectedPromptId);
        if (refreshedSelected) {
          selectPrompt(refreshedSelected);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load prompt library.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  const visiblePrompts = useMemo(() => {
    return prompts.filter((prompt) => {
      if (scopeFilter === 'global') {
        return !prompt.project_id;
      }
      if (scopeFilter === 'project') {
        return !!prompt.project_id;
      }
      return true;
    });
  }, [prompts, scopeFilter]);

  const syncPromptSummary = (promptId: string, summary: PromptTemplateFeedbackSummary | null) => {
    setPrompts((current) =>
      current.map((prompt) => (prompt.id === promptId ? { ...prompt, feedback_summary: summary } : prompt))
    );
  };

  const loadPromptFeedback = async (promptId: string, fallbackSummary?: PromptTemplateFeedbackSummary | null) => {
    if (!promptId) {
      setFeedbackSummary(null);
      setFeedbackItems([]);
      setOptimizationResult(null);
      return;
    }

    setFeedbackLoading(true);
    setFeedbackSummary(fallbackSummary || null);
    try {
      const response = await listPromptFeedback(promptId);
      setFeedbackSummary(response.summary || null);
      setFeedbackItems(response.feedback || []);
      syncPromptSummary(promptId, response.summary || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load prompt feedback.');
      setFeedbackItems([]);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const selectPrompt = (prompt: PromptTemplate) => {
    setSelectedPromptId(prompt.id);
    setForm({
      id: prompt.id,
      project_id: prompt.project_id || '',
      name: prompt.name,
      category: prompt.category,
      target_kind: prompt.target_kind,
      description: prompt.description,
      system_prompt: prompt.system_prompt,
      user_prompt_template: prompt.user_prompt_template,
      tags: (prompt.tags || []).join(', '),
      metadata: JSON.stringify(prompt.metadata || {}, null, 2),
    });
    setFeedbackForm(EMPTY_FEEDBACK_FORM);
    setOptimizationGoal('');
    setVariantName(`${prompt.name} Optimized`);
    setOptimizationResult(null);
    setError('');
    setSuccess('');
    void loadPromptFeedback(prompt.id, prompt.feedback_summary || null);
  };

  const resetForm = () => {
    setSelectedPromptId('');
    setForm(EMPTY_FORM);
    setFeedbackForm(EMPTY_FEEDBACK_FORM);
    setFeedbackSummary(null);
    setFeedbackItems([]);
    setOptimizationGoal('');
    setVariantName('');
    setOptimizationResult(null);
    setError('');
    setSuccess('');
  };

  const savePrompt = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        project_id: form.project_id || null,
        name: form.name.trim(),
        category: form.category.trim() || 'general',
        target_kind: form.target_kind.trim() || 'general',
        description: form.description,
        system_prompt: form.system_prompt,
        user_prompt_template: form.user_prompt_template,
        tags: form.tags
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        metadata: parseJsonObject(form.metadata, 'Metadata'),
      };

      if (!payload.name) {
        throw new Error('Name is required.');
      }

      const saved = form.id
        ? await updatePromptTemplate(form.id, payload)
        : await createPromptTemplate(payload);

      await refresh(saved.project_id || projectFilterId || undefined);
      selectPrompt(saved);
      setSuccess(form.id ? 'Prompt template updated.' : 'Prompt template created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save prompt template.');
    } finally {
      setSaving(false);
    }
  };

  const saveFeedback = async () => {
    if (!form.id) {
      setError('Select or create a prompt template before saving feedback.');
      return;
    }

    setFeedbackSaving(true);
    setError('');
    setSuccess('');
    try {
      await createPromptFeedback(form.id, {
        project_id: form.project_id || null,
        score: Number(feedbackForm.score),
        would_reuse: feedbackForm.would_reuse ? feedbackForm.would_reuse === 'yes' : null,
        use_case: feedbackForm.use_case,
        strengths: parseList(feedbackForm.strengths),
        failure_modes: parseList(feedbackForm.failure_modes),
        notes: feedbackForm.notes,
        task_input: feedbackForm.task_input,
        output_excerpt: feedbackForm.output_excerpt,
      });

      const refreshed = await listPromptFeedback(form.id);
      setFeedbackSummary(refreshed.summary || null);
      setFeedbackItems(refreshed.feedback || []);
      syncPromptSummary(form.id, refreshed.summary || null);
      setFeedbackForm(EMPTY_FEEDBACK_FORM);
      setSuccess('Prompt feedback saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save prompt feedback.');
    } finally {
      setFeedbackSaving(false);
    }
  };

  const runOptimization = async (createVariant: boolean) => {
    if (!form.id) {
      setError('Select or create a prompt template before optimizing it.');
      return;
    }

    setOptimizing(true);
    setError('');
    setSuccess('');
    try {
      const result = await optimizePromptTemplate(form.id, {
        project_id: form.project_id || null,
        goal: optimizationGoal,
        create_variant: createVariant,
        variant_name: variantName,
      });
      setOptimizationResult(result);

      if (result.created_prompt) {
        await refresh(result.created_prompt.project_id || projectFilterId || undefined);
        selectPrompt(result.created_prompt);
        setSuccess('Optimized prompt variant created.');
        return;
      }

      setSuccess('Local prompt optimization suggestion generated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to optimize the prompt template.');
    } finally {
      setOptimizing(false);
    }
  };

  const applyOptimizationToEditor = () => {
    if (!optimizationResult) {
      return;
    }

    let currentMetadata: Record<string, unknown> = {};
    let metadataWarning = '';
    try {
      currentMetadata = parseJsonObject(form.metadata, 'Metadata');
    } catch {
      metadataWarning = 'Existing metadata was invalid JSON, so the optimizer suggestion replaced it with a clean object.';
    }

    setForm((current) => ({
      ...current,
      name: optimizationResult.optimized_name || current.name,
      system_prompt: optimizationResult.system_prompt,
      user_prompt_template: optimizationResult.user_prompt_template,
      metadata: JSON.stringify(
        {
          ...currentMetadata,
          ...optimizationResult.metadata_updates,
        },
        null,
        2
      ),
    }));
    if (metadataWarning) {
      setError(metadataWarning);
    } else {
      setError('');
    }
    setSuccess('Optimization suggestion loaded into the editor.');
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.92fr,1.08fr]">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Prompt Library</h1>
            <p className="mt-2 text-sm text-slate-400">
              Store reusable prompt templates and collect local feedback so StudioOS can improve prompt quality over time.
            </p>
          </div>
          <Button variant="secondary" onClick={resetForm}>
            New Prompt
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            Scope
            <select
              value={scopeFilter}
              onChange={(event) => setScopeFilter(event.target.value as 'all' | 'global' | 'project')}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            >
              <option value="all">All prompts</option>
              <option value="global">Global only</option>
              <option value="project">Project prompts</option>
            </select>
          </label>

          <label className="text-sm text-slate-300">
            Project Context Filter
            <select
              value={projectFilterId}
              onChange={(event) => {
                const next = event.target.value;
                setProjectFilterId(next);
                refresh(next).catch(() => undefined);
              }}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white"
            >
              <option value="">Global + all project prompts</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-5 space-y-3">
          {loading && <p className="text-sm text-slate-500">Loading prompt templates…</p>}
          {!loading &&
            visiblePrompts.map((prompt) => {
              const isActive = prompt.id === selectedPromptId;
              const summary = prompt.feedback_summary;
              return (
                <button
                  key={prompt.id}
                  type="button"
                  onClick={() => selectPrompt(prompt)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    isActive
                      ? 'border-amber-400 bg-amber-400/10'
                      : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{prompt.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                        {prompt.category} · {prompt.target_kind}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-400">
                      {prompt.project_id ? 'Project' : 'Global'}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-400">{prompt.description || 'No description.'}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(prompt.tags || []).map((tag) => (
                      <span key={tag} className="rounded-full bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>{summary?.feedback_count ?? 0} feedback</span>
                    <span>avg {summary?.average_score?.toFixed(1) ?? '0.0'}/5</span>
                    <span>reuse {formatRate(summary?.reuse_rate)}</span>
                  </div>
                </button>
              );
            })}
          {!loading && visiblePrompts.length === 0 && <p className="text-sm text-slate-500">No prompts match this filter.</p>}
        </div>
      </section>

      <section className="space-y-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{form.id ? 'Edit Prompt' : 'Create Prompt'}</h2>
              <p className="mt-1 text-sm text-slate-400">
                These templates can be reused from Brand Bible autocomplete, memory automation, and future workflow tools.
              </p>
            </div>
            <Button onClick={savePrompt} loading={saving}>
              {form.id ? 'Save Changes' : 'Create Prompt'}
            </Button>
          </div>

          {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}
          {success && <p className="mt-4 text-sm text-emerald-300">{success}</p>}

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              />
            </Field>
            <Field label="Project Scope">
              <select
                value={form.project_id}
                onChange={(event) => setForm((current) => ({ ...current, project_id: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              >
                <option value="">Global prompt</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <input
                value={form.category}
                onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              />
            </Field>
            <Field label="Target Kind">
              <input
                value={form.target_kind}
                onChange={(event) => setForm((current) => ({ ...current, target_kind: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              />
            </Field>
          </div>

          <Field label="Description" className="mt-4">
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              className="mt-2 min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
            />
          </Field>

          <Field label="System Prompt" className="mt-4">
            <textarea
              value={form.system_prompt}
              onChange={(event) => setForm((current) => ({ ...current, system_prompt: event.target.value }))}
              className="mt-2 min-h-40 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white"
            />
          </Field>

          <Field label="User Prompt Template" className="mt-4">
            <textarea
              value={form.user_prompt_template}
              onChange={(event) => setForm((current) => ({ ...current, user_prompt_template: event.target.value }))}
              className="mt-2 min-h-56 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white"
            />
          </Field>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Tags">
              <input
                value={form.tags}
                onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              />
            </Field>
            <Field label="Metadata JSON">
              <textarea
                value={form.metadata}
                onChange={(event) => setForm((current) => ({ ...current, metadata: event.target.value }))}
                className="mt-2 min-h-28 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white"
              />
            </Field>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
            <p className="font-medium text-white">Template Variables</p>
            <p className="mt-2">
              Use placeholders like <code>{'{{project_name}}'}</code>, <code>{'{{project_description}}'}</code>,{' '}
              <code>{'{{project_domains}}'}</code>, <code>{'{{requested_field}}'}</code>, <code>{'{{guidance}}'}</code>,{' '}
              <code>{'{{brand_bible_json}}'}</code>, <code>{'{{story_bible_json}}'}</code>, and{' '}
              <code>{'{{document_context}}'}</code>.
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Prompt Feedback</h2>
              <p className="mt-1 text-sm text-slate-400">
                Capture what worked and what failed so StudioOS can learn which prompt variants are worth keeping.
              </p>
            </div>
            <Button variant="secondary" onClick={saveFeedback} loading={feedbackSaving}>
              Save Feedback
            </Button>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <MetricCard label="Feedback Count" value={String(feedbackSummary?.feedback_count ?? 0)} />
            <MetricCard label="Average Score" value={(feedbackSummary?.average_score ?? 0).toFixed(1)} />
            <MetricCard label="Reuse Rate" value={formatRate(feedbackSummary?.reuse_rate)} />
            <MetricCard label="Common Failures" value={String(feedbackSummary?.common_failures.length ?? 0)} />
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Field label="Score (1-5)">
              <select
                value={feedbackForm.score}
                onChange={(event) => setFeedbackForm((current) => ({ ...current, score: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              >
                {[1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={String(value)}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Would Reuse">
              <select
                value={feedbackForm.would_reuse}
                onChange={(event) => setFeedbackForm((current) => ({ ...current, would_reuse: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
              >
                <option value="">No vote</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>
            <Field label="Use Case">
              <input
                value={feedbackForm.use_case}
                onChange={(event) => setFeedbackForm((current) => ({ ...current, use_case: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
                placeholder="Brand autocomplete, memory summary, scene plan..."
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Strengths">
              <textarea
                value={feedbackForm.strengths}
                onChange={(event) => setFeedbackForm((current) => ({ ...current, strengths: event.target.value }))}
                className="mt-2 min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
                placeholder="One per line or comma-separated"
              />
            </Field>
            <Field label="Failure Modes">
              <textarea
                value={feedbackForm.failure_modes}
                onChange={(event) => setFeedbackForm((current) => ({ ...current, failure_modes: event.target.value }))}
                className="mt-2 min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
                placeholder="Format drift, weak citations, too verbose..."
              />
            </Field>
          </div>

          <Field label="Notes" className="mt-4">
            <textarea
              value={feedbackForm.notes}
              onChange={(event) => setFeedbackForm((current) => ({ ...current, notes: event.target.value }))}
              className="mt-2 min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
              placeholder="What should the next prompt revision preserve or fix?"
            />
          </Field>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Task Input">
              <textarea
                value={feedbackForm.task_input}
                onChange={(event) => setFeedbackForm((current) => ({ ...current, task_input: event.target.value }))}
                className="mt-2 min-h-28 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
                placeholder="Short sample of the request or context that triggered this prompt."
              />
            </Field>
            <Field label="Output Excerpt">
              <textarea
                value={feedbackForm.output_excerpt}
                onChange={(event) => setFeedbackForm((current) => ({ ...current, output_excerpt: event.target.value }))}
                className="mt-2 min-h-28 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
                placeholder="Representative output excerpt to anchor the feedback."
              />
            </Field>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-medium text-white">Recent Feedback</p>
              {feedbackLoading && <p className="text-xs text-slate-500">Loading feedback…</p>}
            </div>
            <div className="mt-3 space-y-3">
              {feedbackItems.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-200">score {item.score}/5</span>
                    <span>{item.feedback_source}</span>
                    <span>{item.use_case || 'general use'}</span>
                    <span>{new Date(item.created_at).toLocaleString()}</span>
                  </div>
                  {item.notes && <p className="mt-2 text-sm text-slate-300">{item.notes}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.strengths.map((value) => (
                      <span key={`${item.id}-strength-${value}`} className="rounded-full bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-200">
                        {value}
                      </span>
                    ))}
                    {item.failure_modes.map((value) => (
                      <span key={`${item.id}-failure-${value}`} className="rounded-full bg-rose-400/10 px-2 py-1 text-[11px] text-rose-200">
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {!feedbackLoading && feedbackItems.length === 0 && (
                <p className="text-sm text-slate-500">No feedback recorded for this prompt yet.</p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Local Prompt Optimizer</h2>
              <p className="mt-1 text-sm text-slate-400">
                Use the local workflow model to propose prompt revisions from accumulated operator feedback.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void runOptimization(false)} loading={optimizing}>
                Suggest Improvement
              </Button>
              <Button onClick={() => void runOptimization(true)} loading={optimizing}>
                Create Variant
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Optimization Goal">
              <textarea
                value={optimizationGoal}
                onChange={(event) => setOptimizationGoal(event.target.value)}
                className="mt-2 min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
                placeholder="Improve format adherence, reduce verbosity, preserve strong scientific tone..."
              />
            </Field>
            <Field label="Variant Name">
              <input
                value={variantName}
                onChange={(event) => setVariantName(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
                placeholder="Prompt Name Optimized"
              />
            </Field>
          </div>

          {optimizationResult && (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-white">{optimizationResult.optimized_name}</p>
                    <p className="mt-1 text-sm text-slate-400">{optimizationResult.rationale}</p>
                  </div>
                  {!optimizationResult.created_prompt && (
                    <Button variant="secondary" onClick={applyOptimizationToEditor}>
                      Load Into Editor
                    </Button>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {optimizationResult.changes.map((change) => (
                    <span key={change} className="rounded-full bg-sky-400/10 px-2 py-1 text-[11px] text-sky-200">
                      {change}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <Field label="Suggested System Prompt">
                  <textarea
                    readOnly
                    value={optimizationResult.system_prompt}
                    className="mt-2 min-h-40 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white"
                  />
                </Field>
                <Field label="Suggested User Prompt Template">
                  <textarea
                    readOnly
                    value={optimizationResult.user_prompt_template}
                    className="mt-2 min-h-48 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white"
                  />
                </Field>
              </div>
            </div>
          )}
        </section>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-sm text-slate-300 ${className}`}>
      {label}
      {children}
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function parseJsonObject(rawValue: string, label: string): Record<string, unknown> {
  const source = rawValue.trim();
  if (!source) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label}: ${formatJsonError(error)}`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function formatJsonError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Invalid JSON.';
}

function parseList(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatRate(value: number | null | undefined): string {
  if (typeof value !== 'number') {
    return 'n/a';
  }
  return `${Math.round(value * 100)}%`;
}
