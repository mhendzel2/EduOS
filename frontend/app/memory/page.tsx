'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import Button from '@/components/ui/button';
import {
  autocompleteProjectMemory,
  autocompleteWorkspaceMemory,
  getProjectMemory,
  getWorkspaceMemory,
  listProjects,
  listPromptTemplates,
  updateProjectMemory,
  updateWorkspaceMemory,
} from '@/lib/api';
import type { PromptTemplate, ProjectMemory, StudioProject, WorkspaceMemory } from '@/lib/types';

const EMPTY_WORKSPACE_MEMORY: WorkspaceMemory = {
  id: 'global',
  summary: '',
  pinned_facts: [],
  active_token_estimate: 0,
  compaction_count: 0,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

const EMPTY_PROJECT_MEMORY: ProjectMemory = {
  project_id: '',
  summary: '',
  pinned_facts: [],
  active_token_estimate: 0,
  compaction_count: 0,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};

export default function MemoryPage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectId, setProjectId] = useState('');

  const [workspaceMemory, setWorkspaceMemory] = useState<WorkspaceMemory>(EMPTY_WORKSPACE_MEMORY);
  const [workspaceFactsText, setWorkspaceFactsText] = useState('');
  const [workspacePrompts, setWorkspacePrompts] = useState<PromptTemplate[]>([]);
  const [workspacePromptId, setWorkspacePromptId] = useState('');
  const [workspaceGuidance, setWorkspaceGuidance] = useState('');
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceAutofilling, setWorkspaceAutofilling] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [workspaceSuccess, setWorkspaceSuccess] = useState('');
  const [workspaceAiSummary, setWorkspaceAiSummary] = useState('');

  const [projectMemory, setProjectMemory] = useState<ProjectMemory>(EMPTY_PROJECT_MEMORY);
  const [projectFactsText, setProjectFactsText] = useState('');
  const [projectPrompts, setProjectPrompts] = useState<PromptTemplate[]>([]);
  const [projectPromptId, setProjectPromptId] = useState('');
  const [projectGuidance, setProjectGuidance] = useState('');
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectAutofilling, setProjectAutofilling] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [projectSuccess, setProjectSuccess] = useState('');
  const [projectAiSummary, setProjectAiSummary] = useState('');

  useEffect(() => {
    listProjects()
      .then((data) => {
        setProjects(data.projects);
        setProjectId((current) => current || data.projects[0]?.id || '');
      })
      .catch((err) => setProjectError(err instanceof Error ? err.message : 'Unable to load projects.'));
  }, []);

  useEffect(() => {
    setWorkspaceLoading(true);
    Promise.all([
      getWorkspaceMemory(),
      listPromptTemplates({ category: 'workspace_memory_autocomplete' }),
    ])
      .then(([memory, prompts]) => {
        setWorkspaceMemory(memory);
        setWorkspaceFactsText(factsToTextarea(memory.pinned_facts));
        setWorkspacePrompts(prompts.prompts);
        setWorkspacePromptId((current) => {
          if (current && prompts.prompts.some((prompt) => prompt.id === current)) {
            return current;
          }
          return prompts.prompts[0]?.id || '';
        });
        setWorkspaceError('');
      })
      .catch((err) => setWorkspaceError(err instanceof Error ? err.message : 'Unable to load workspace memory.'))
      .finally(() => setWorkspaceLoading(false));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setProjectMemory(EMPTY_PROJECT_MEMORY);
      setProjectFactsText('');
      setProjectPrompts([]);
      setProjectPromptId('');
      return;
    }

    setProjectLoading(true);
    Promise.all([
      getProjectMemory(projectId),
      listPromptTemplates({ category: 'project_memory_autocomplete', projectId }),
    ])
      .then(([memory, prompts]) => {
        setProjectMemory(memory);
        setProjectFactsText(factsToTextarea(memory.pinned_facts));
        setProjectPrompts(prompts.prompts);
        setProjectPromptId((current) => {
          if (current && prompts.prompts.some((prompt) => prompt.id === current)) {
            return current;
          }
          return prompts.prompts[0]?.id || '';
        });
        setProjectError('');
      })
      .catch((err) => setProjectError(err instanceof Error ? err.message : 'Unable to load project memory.'))
      .finally(() => setProjectLoading(false));
  }, [projectId]);

  const selectedWorkspacePrompt = useMemo(
    () => workspacePrompts.find((prompt) => prompt.id === workspacePromptId) || workspacePrompts[0] || null,
    [workspacePrompts, workspacePromptId]
  );
  const selectedProjectPrompt = useMemo(
    () => projectPrompts.find((prompt) => prompt.id === projectPromptId) || projectPrompts[0] || null,
    [projectPrompts, projectPromptId]
  );

  const saveWorkspace = async () => {
    setWorkspaceSaving(true);
    setWorkspaceError('');
    setWorkspaceSuccess('');
    try {
      const saved = await updateWorkspaceMemory({
        summary: workspaceMemory.summary,
        pinned_facts: parseFactsText(workspaceFactsText),
      });
      setWorkspaceMemory(saved);
      setWorkspaceFactsText(factsToTextarea(saved.pinned_facts));
      setWorkspaceSuccess('Workspace memory saved.');
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to save workspace memory.');
    } finally {
      setWorkspaceSaving(false);
    }
  };

  const saveProject = async () => {
    if (!projectId) return;
    setProjectSaving(true);
    setProjectError('');
    setProjectSuccess('');
    try {
      const saved = await updateProjectMemory(projectId, {
        summary: projectMemory.summary,
        pinned_facts: parseFactsText(projectFactsText),
      });
      setProjectMemory(saved);
      setProjectFactsText(factsToTextarea(saved.pinned_facts));
      setProjectSuccess('Project memory saved.');
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : 'Unable to save project memory.');
    } finally {
      setProjectSaving(false);
    }
  };

  const runWorkspaceAutocomplete = async () => {
    setWorkspaceAutofilling(true);
    setWorkspaceError('');
    setWorkspaceSuccess('');
    try {
      const result = await autocompleteWorkspaceMemory({
        prompt_template_id: selectedWorkspacePrompt?.id || null,
        guidance: workspaceGuidance,
      });
      setWorkspaceMemory((current) => ({
        ...current,
        summary: result.summary,
        pinned_facts: result.pinned_facts,
      }));
      setWorkspaceFactsText(factsToTextarea(result.pinned_facts));
      setWorkspaceAiSummary(
        [result.rationale, result.context_sources.length > 0 ? `Context: ${result.context_sources.join(', ')}` : '']
          .filter(Boolean)
          .join(' ')
      );
      setWorkspaceSuccess('Workspace memory refreshed with AI suggestions.');
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to autocomplete workspace memory.');
    } finally {
      setWorkspaceAutofilling(false);
    }
  };

  const runProjectAutocomplete = async () => {
    if (!projectId) return;
    setProjectAutofilling(true);
    setProjectError('');
    setProjectSuccess('');
    try {
      const result = await autocompleteProjectMemory(projectId, {
        prompt_template_id: selectedProjectPrompt?.id || null,
        guidance: projectGuidance,
      });
      setProjectMemory((current) => ({
        ...current,
        summary: result.summary,
        pinned_facts: result.pinned_facts,
      }));
      setProjectFactsText(factsToTextarea(result.pinned_facts));
      setProjectAiSummary(
        [result.rationale, result.context_sources.length > 0 ? `Context: ${result.context_sources.join(', ')}` : '']
          .filter(Boolean)
          .join(' ')
      );
      setProjectSuccess('Project memory refreshed with AI suggestions.');
    } catch (err) {
      setProjectError(err instanceof Error ? err.message : 'Unable to autocomplete project memory.');
    } finally {
      setProjectAutofilling(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr,1fr]">
      <MemoryEditor
        title="Workspace Memory"
        subtitle="Shared operating memory for repeated tasks, automation rules, and preferences that should apply across projects."
        loading={workspaceLoading}
        saving={workspaceSaving}
        autofilling={workspaceAutofilling}
        summary={workspaceMemory.summary}
        factsText={workspaceFactsText}
        prompts={workspacePrompts}
        selectedPromptId={selectedWorkspacePrompt?.id || ''}
        guidance={workspaceGuidance}
        tokenEstimate={workspaceMemory.active_token_estimate}
        updatedAt={workspaceMemory.updated_at}
        error={workspaceError}
        success={workspaceSuccess}
        aiSummary={workspaceAiSummary}
        onSummaryChange={(value) => setWorkspaceMemory((current) => ({ ...current, summary: value }))}
        onFactsChange={setWorkspaceFactsText}
        onPromptChange={setWorkspacePromptId}
        onGuidanceChange={setWorkspaceGuidance}
        onAutofill={() => void runWorkspaceAutocomplete()}
        onSave={() => void saveWorkspace()}
      />

      <MemoryEditor
        title="Project Memory"
        subtitle="Local memory for project-specific content rules, constraints, and recurring production details."
        loading={projectLoading}
        saving={projectSaving}
        autofilling={projectAutofilling}
        summary={projectMemory.summary}
        factsText={projectFactsText}
        prompts={projectPrompts}
        selectedPromptId={selectedProjectPrompt?.id || ''}
        guidance={projectGuidance}
        tokenEstimate={projectMemory.active_token_estimate}
        updatedAt={projectMemory.updated_at}
        error={projectError}
        success={projectSuccess}
        aiSummary={projectAiSummary}
        selector={
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-sm text-white"
          >
            <option value="">Select a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        }
        onSummaryChange={(value) => setProjectMemory((current) => ({ ...current, summary: value }))}
        onFactsChange={setProjectFactsText}
        onPromptChange={setProjectPromptId}
        onGuidanceChange={setProjectGuidance}
        onAutofill={() => void runProjectAutocomplete()}
        onSave={() => void saveProject()}
      />
    </div>
  );
}

function MemoryEditor(props: {
  title: string;
  subtitle: string;
  loading: boolean;
  saving: boolean;
  autofilling: boolean;
  summary: string;
  factsText: string;
  prompts: PromptTemplate[];
  selectedPromptId: string;
  guidance: string;
  tokenEstimate: number;
  updatedAt?: string;
  error: string;
  success: string;
  aiSummary: string;
  selector?: ReactNode;
  onSummaryChange: (value: string) => void;
  onFactsChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onGuidanceChange: (value: string) => void;
  onAutofill: () => void;
  onSave: () => void;
}) {
  const selectedPrompt = props.prompts.find((prompt) => prompt.id === props.selectedPromptId) || props.prompts[0] || null;

  return (
    <section className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-white">{props.title}</h1>
          <p className="mt-2 text-sm text-slate-400">{props.subtitle}</p>
        </div>
        {props.selector}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">AI Refresh</h2>
            <p className="mt-2 text-sm text-slate-400">
              Build reusable memory from the existing context so repeated tasks can inherit the same operating guidance.
            </p>
          </div>
          <Button variant="secondary" onClick={props.onAutofill} loading={props.autofilling}>
            Refresh Memory
          </Button>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <label className="block text-sm text-slate-300">
            Prompt Template
            <select
              value={props.selectedPromptId}
              onChange={(event) => props.onPromptChange(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
            >
              {props.prompts.map((prompt) => (
                <option key={prompt.id} value={prompt.id}>
                  {prompt.name}
                  {prompt.project_id ? ' · project' : ' · global'}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm text-slate-300">
            Extra Guidance
            <textarea
              value={props.guidance}
              onChange={(event) => props.onGuidanceChange(event.target.value)}
              placeholder="Optional: mention recurring workflows, naming rules, editorial constraints, or automation preferences."
              className="mt-2 min-h-24 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
            />
          </label>
        </div>

        {selectedPrompt && <p className="mt-4 text-sm text-slate-500">{selectedPrompt.description}</p>}
        {props.aiSummary && <p className="mt-3 text-sm text-cyan-300">{props.aiSummary}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <label className="text-sm text-slate-300">
          Summary
          <textarea
            value={props.summary}
            onChange={(event) => props.onSummaryChange(event.target.value)}
            className="mt-2 min-h-48 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
          />
        </label>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
          <p className="text-sm font-medium text-white">Memory Stats</p>
          <dl className="mt-4 space-y-3 text-sm text-slate-300">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500">Token estimate</dt>
              <dd>{props.tokenEstimate}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-500">Pinned facts</dt>
              <dd>{parseFactsText(props.factsText).length}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-slate-500">Updated</dt>
              <dd>{props.updatedAt ? formatDate(props.updatedAt) : 'Not saved yet'}</dd>
            </div>
          </dl>
        </div>
      </div>

      <label className="block text-sm text-slate-300">
        Pinned Facts
        <textarea
          value={props.factsText}
          onChange={(event) => props.onFactsChange(event.target.value)}
          placeholder="One stable fact per line"
          className="mt-2 min-h-56 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white"
        />
      </label>

      {(props.error || props.success) && (
        <div className="flex flex-col gap-2">
          {props.error && <p className="text-sm text-rose-300">{props.error}</p>}
          {props.success && <p className="text-sm text-emerald-300">{props.success}</p>}
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={props.onSave} loading={props.saving}>
          Save Memory
        </Button>
      </div>

      {props.loading && <p className="text-sm text-slate-500">Loading memory…</p>}
    </section>
  );
}

function parseFactsText(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function factsToTextarea(facts: string[]): string {
  return (facts || []).join('\n');
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}
