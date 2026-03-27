'use client';

import { useState } from 'react';
import Link from 'next/link';

import Button from '@/components/ui/button';
import { runProjectWorkflowCommand } from '@/lib/api';
import type { WorkflowCommandResponse } from '@/lib/types';

interface WorkflowCommandPanelProps {
  projectId: string;
  scope?: 'workspace' | 'media' | 'general';
  title?: string;
  description?: string;
  documentIds?: string[];
  artifactIds?: string[];
  contextLabel?: string;
  onExecuted?: (response: WorkflowCommandResponse) => void;
}

function routeLabel(result: WorkflowCommandResponse): string {
  if (result.plan.execution_mode === 'agent') {
    return `${result.plan.workforce}.${result.plan.agent_id}`;
  }
  if (result.plan.execution_mode === 'pipeline') {
    return `${result.plan.pipeline_kind} pipeline`;
  }
  return `${result.plan.steps.length} custom step${result.plan.steps.length === 1 ? '' : 's'}`;
}

export default function WorkflowCommandPanel({
  projectId,
  scope = 'general',
  title = 'Local Workflow Commands',
  description = 'Use natural-language commands to route local-Ollama workflow execution across the current project.',
  documentIds = [],
  artifactIds = [],
  contextLabel,
  onExecuted,
}: WorkflowCommandPanelProps) {
  const [command, setCommand] = useState('');
  const [result, setResult] = useState<WorkflowCommandResponse | null>(null);
  const [busyMode, setBusyMode] = useState<'plan' | 'run' | null>(null);
  const [error, setError] = useState('');

  const selectedDocumentIds = documentIds.filter(Boolean);
  const selectedArtifactIds = artifactIds.filter(Boolean);

  const submit = async (execute: boolean) => {
    const trimmed = command.trim();
    if (!projectId || !trimmed) {
      return;
    }

    setBusyMode(execute ? 'run' : 'plan');
    try {
      const response = await runProjectWorkflowCommand(projectId, {
        command: trimmed,
        scope,
        document_ids: selectedDocumentIds,
        artifact_ids: selectedArtifactIds,
        execute,
      });
      setResult(response);
      setError('');
      if (execute) {
        onExecuted?.(response);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Workflow command failed.');
    } finally {
      setBusyMode(null);
    }
  };

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-slate-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">{description}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
          <p>Local runtime: Ollama</p>
          <p className="mt-1">
            If commands fail because the local model is down, start it from{' '}
            <Link href="/settings" className="text-cyan-300 hover:text-cyan-200">
              Settings
            </Link>
            .
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
          Scope: <span className="text-white">{scope}</span>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
          Target documents: <span className="text-white">{selectedDocumentIds.length}</span>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
          Target artifacts: <span className="text-white">{selectedArtifactIds.length}</span>
        </div>
      </div>

      {contextLabel && <p className="mt-3 text-xs text-slate-500">{contextLabel}</p>}

      <textarea
        value={command}
        onChange={(event) => setCommand(event.target.value)}
        placeholder="Example: Critique the selected video, produce a stronger long-form edit plan, then generate shorts guidance and channel branding notes."
        className="mt-4 min-h-32 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          onClick={() => void submit(true)}
          loading={busyMode === 'run'}
          disabled={!projectId || !command.trim()}
          className="bg-cyan-500 text-slate-950 hover:bg-cyan-400"
        >
          Run Local Command
        </Button>
        <Button
          variant="secondary"
          onClick={() => void submit(false)}
          loading={busyMode === 'plan'}
          disabled={!projectId || !command.trim()}
        >
          Preview Plan
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{result.plan.summary}</p>
                <p className="mt-1 text-xs text-slate-500">{result.plan.rationale}</p>
              </div>
              <div className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs font-medium text-cyan-200">
                {routeLabel(result)}
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
                Model: <span className="text-slate-200">{result.model}</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
                Mode: <span className="text-slate-200">{result.plan.execution_mode}</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
                Documents: <span className="text-slate-200">{result.plan.referenced_document_ids.length}</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
                Artifacts: <span className="text-slate-200">{result.plan.referenced_artifact_ids.length}</span>
              </div>
            </div>

            {result.plan.context_focus.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {result.plan.context_focus.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300"
                  >
                    {item}
                  </span>
                ))}
              </div>
            )}

            {result.plan.steps.length > 0 && (
              <div className="mt-4 space-y-2">
                {result.plan.steps.map((step, index) => (
                  <div key={`${step.workforce}-${step.agent_id}-${index}`} className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                    <p className="text-sm font-medium text-white">
                      {index + 1}. {step.workforce}.{step.agent_id}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">{step.description}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {result.execution && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium text-white">Execution Result</p>
                <span className="text-xs text-slate-500">
                  Run {result.execution.run.id.slice(0, 8)} · {result.execution.run.status}
                </span>
              </div>

              <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-200">
                {result.execution.final_output || 'No final output returned.'}
              </pre>

              {result.execution.pipeline_errors.length > 0 && (
                <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
                  {result.execution.pipeline_errors.join('\n')}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
