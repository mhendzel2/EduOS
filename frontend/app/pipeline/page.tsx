'use client';

import { useEffect, useMemo, useState } from 'react';
import { getProjectDomains, listProjects, runProjectCustomPipeline } from '@/lib/api';
import type { PipelineBuilderStep, PipelineRunResponse, StudioProject, WorkforceStatus } from '@/lib/types';

type AgentTemplate = {
  label: string;
  role: string;
  step: PipelineBuilderStep;
};

type PipelineTemplate = {
  id: string;
  title: string;
  description: string;
  steps: PipelineBuilderStep[];
};

function createStepTemplate(
  workforce: string,
  agentId: string,
  description: string,
  artifactType?: string | null,
  requiresArtifacts: string[] = [],
  isGate = false,
  gateInputArtifact?: string | null
): PipelineBuilderStep {
  return {
    workforce,
    agent_id: agentId,
    description,
    artifact_type: artifactType ?? null,
    requires_artifacts: [...requiresArtifacts],
    is_gate: isGate,
    gate_input_artifact: gateInputArtifact ?? null,
  };
}

function cloneStep(step: PipelineBuilderStep): PipelineBuilderStep {
  return {
    ...step,
    requires_artifacts: [...step.requires_artifacts],
  };
}

const AGENT_LIBRARY: Record<string, AgentTemplate[]> = {
  coordination: [
    {
      label: 'Director',
      role: 'Plans the cooperative execution brief',
      step: createStepTemplate(
        'coordination',
        'director',
        'Create the execution brief and coordinate the workforce handoff.',
        'execution_brief'
      ),
    },
  ],
  writing: [
    {
      label: 'Outline',
      role: 'Build the draft outline',
      step: createStepTemplate('writing', 'outline', 'Generate the working outline.', 'outline'),
    },
    {
      label: 'Writer',
      role: 'Draft the next story asset',
      step: createStepTemplate('writing', 'writer', 'Draft the next scene from the outline.', 'scene_draft', ['outline']),
    },
    {
      label: 'Critique',
      role: 'Structural quality gate',
      step: createStepTemplate(
        'writing',
        'critique',
        'Review the draft for structural quality and revisions.',
        'edit_pass',
        ['scene_draft'],
        true,
        'scene_draft'
      ),
    },
    {
      label: 'Worldbuilding',
      role: 'Continuity gate',
      step: createStepTemplate(
        'writing',
        'worldbuilding',
        'Check continuity and canon consistency.',
        'continuity_record',
        ['edit_pass'],
        true,
        'edit_pass'
      ),
    },
  ],
  media: [
    {
      label: 'Research',
      role: 'Create the media brief',
      step: createStepTemplate('media', 'research', 'Create the research brief.', 'research_brief', ['execution_brief']),
    },
    {
      label: 'Scriptwriter',
      role: 'Draft the source script',
      step: createStepTemplate('media', 'scriptwriter', 'Write the production script.', 'script', ['research_brief']),
    },
    {
      label: 'Script Critic',
      role: 'Gate the script',
      step: createStepTemplate(
        'media',
        'script_critic',
        'Review the script quality before production.',
        null,
        ['script'],
        true,
        'script'
      ),
    },
    {
      label: 'Video Critic',
      role: 'Assess uploaded source footage',
      step: createStepTemplate(
        'media',
        'video_critic',
        'Assess the source video and recommend edits.',
        'video_critique',
        ['script']
      ),
    },
    {
      label: 'Video Editor',
      role: 'Plan long-form edit pass',
      step: createStepTemplate(
        'media',
        'video_editor',
        'Create the long-form edit plan.',
        'video_edit_plan',
        ['script', 'video_critique']
      ),
    },
    {
      label: 'Shorts Editor',
      role: 'Plan shorts derivatives',
      step: createStepTemplate(
        'media',
        'shorts_editor',
        'Create YouTube Shorts edit recommendations.',
        'shorts_edit_plan',
        ['script', 'video_critique']
      ),
    },
    {
      label: 'Channel Brand',
      role: 'Package channel-specific branding',
      step: createStepTemplate(
        'media',
        'channel_brand',
        'Prepare channel branding overlays and guidance.',
        'channel_branding_package',
        ['video_edit_plan', 'shorts_edit_plan']
      ),
    },
    {
      label: 'SEO',
      role: 'Prepare metadata package',
      step: createStepTemplate('media', 'seo', 'Generate the SEO package.', 'seo_package', ['script']),
    },
    {
      label: 'Thumbnail',
      role: 'Draft the thumbnail brief',
      step: createStepTemplate(
        'media',
        'thumbnail_brief',
        'Create the thumbnail brief.',
        'thumbnail_brief',
        ['script']
      ),
    },
    {
      label: 'Visual Critic',
      role: 'Gate the thumbnail direction',
      step: createStepTemplate(
        'media',
        'visual_critic',
        'Review the thumbnail package.',
        null,
        ['thumbnail_brief'],
        true,
        'thumbnail_brief'
      ),
    },
    {
      label: 'Audio Planner',
      role: 'Create audio coverage plan',
      step: createStepTemplate('media', 'audio_planner', 'Create the audio plan.', 'audio_plan', ['script']),
    },
    {
      label: 'Assembly Planner',
      role: 'Merge the media package',
      step: createStepTemplate(
        'media',
        'assembly_planner',
        'Assemble the release package.',
        'assembly_plan',
        ['seo_package', 'thumbnail_brief', 'audio_plan', 'video_edit_plan', 'shorts_edit_plan', 'channel_branding_package']
      ),
    },
    {
      label: 'Distribution',
      role: 'Prepare YouTube and webhost delivery',
      step: createStepTemplate(
        'media',
        'distribution_manager',
        'Prepare YouTube and web distribution packaging.',
        'distribution_package',
        ['assembly_plan']
      ),
    },
    {
      label: 'Publish',
      role: 'Create final publish package',
      step: createStepTemplate(
        'media',
        'site_manager',
        'Finalize the publish package.',
        'publish_package',
        ['distribution_package']
      ),
    },
  ],
  promo: [
    {
      label: 'Campaign Planner',
      role: 'Set promo sequence',
      step: createStepTemplate('promo', 'campaign_planner', 'Create the campaign plan.', 'promo_brief', ['execution_brief']),
    },
    {
      label: 'Hook Extractor',
      role: 'Pull promo hooks',
      step: createStepTemplate(
        'promo',
        'story_hook_extractor',
        'Extract story hooks for promo.',
        'story_hook_set',
        ['promo_brief']
      ),
    },
    {
      label: 'Spoiler Guardian',
      role: 'Gate spoiler risk',
      step: createStepTemplate(
        'promo',
        'spoiler_guardian',
        'Gate promotional hooks for spoiler safety.',
        'spoiler_cleared_hooks',
        ['story_hook_set'],
        true,
        'story_hook_set'
      ),
    },
    {
      label: 'Promo Adapter',
      role: 'Adapt for channels',
      step: createStepTemplate(
        'promo',
        'promo_adapter',
        'Adapt the cleared hooks into a channel-ready calendar.',
        'promo_calendar',
        ['spoiler_cleared_hooks']
      ),
    },
  ],
};

function findAgentTemplate(workforce: string, agentId: string): AgentTemplate | undefined {
  return AGENT_LIBRARY[workforce]?.find((template) => template.step.agent_id === agentId);
}

function buildStep(workforce: string, agentId: string): PipelineBuilderStep {
  return cloneStep(
    findAgentTemplate(workforce, agentId)?.step
    ?? createStepTemplate(workforce, agentId, `Run ${workforce}.${agentId}`)
  );
}

const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: 'video-publishing',
    title: 'Video Publishing',
    description: 'Coordinate research, critique, long-form edits, Shorts cuts, branding, and distribution.',
    steps: [
      buildStep('coordination', 'director'),
      buildStep('media', 'research'),
      buildStep('media', 'scriptwriter'),
      buildStep('media', 'script_critic'),
      buildStep('media', 'video_critic'),
      buildStep('media', 'video_editor'),
      buildStep('media', 'shorts_editor'),
      buildStep('media', 'channel_brand'),
      buildStep('media', 'seo'),
      buildStep('media', 'thumbnail_brief'),
      buildStep('media', 'visual_critic'),
      buildStep('media', 'audio_planner'),
      buildStep('media', 'assembly_planner'),
      buildStep('media', 'distribution_manager'),
      buildStep('media', 'site_manager'),
    ],
  },
  {
    id: 'web-release',
    title: 'Web Release',
    description: 'Coordinate the execution brief, content package, and final webhost delivery.',
    steps: [
      buildStep('coordination', 'director'),
      buildStep('media', 'research'),
      buildStep('media', 'scriptwriter'),
      buildStep('media', 'seo'),
      buildStep('media', 'thumbnail_brief'),
      buildStep('media', 'audio_planner'),
      buildStep('media', 'assembly_planner'),
      buildStep('media', 'distribution_manager'),
      buildStep('media', 'site_manager'),
    ],
  },
  {
    id: 'story-to-promo',
    title: 'Story To Promo',
    description: 'Assemble writing, promo, and coordination workforces around one launch brief.',
    steps: [
      buildStep('coordination', 'director'),
      buildStep('writing', 'outline'),
      buildStep('writing', 'writer'),
      buildStep('writing', 'critique'),
      buildStep('promo', 'campaign_planner'),
      buildStep('promo', 'story_hook_extractor'),
      buildStep('promo', 'spoiler_guardian'),
      buildStep('promo', 'promo_adapter'),
    ],
  },
];

function getCompatibleTemplates(status: WorkforceStatus | null): PipelineTemplate[] {
  if (!status) {
    return [];
  }

  return PIPELINE_TEMPLATES.filter((template) =>
    template.steps.every((step) => status.agents[step.workforce]?.includes(step.agent_id))
  );
}

function buildFallbackStep(status: WorkforceStatus | null): PipelineBuilderStep | null {
  if (!status) {
    return null;
  }

  const preferredWorkforce = status.active_workforces.includes('coordination')
    ? 'coordination'
    : status.active_workforces[0];
  if (!preferredWorkforce) {
    return null;
  }

  const agentId = status.agents[preferredWorkforce]?.[0];
  if (!agentId) {
    return null;
  }

  return buildStep(preferredWorkforce, agentId);
}

function parseArtifacts(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function PipelinePage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [workforceStatus, setWorkforceStatus] = useState<WorkforceStatus | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [task, setTask] = useState(
    'Coordinate the video workflow, produce the edit recommendations, and prepare the final distribution package.'
  );
  const [steps, setSteps] = useState<PipelineBuilderStep[]>([]);
  const [result, setResult] = useState<PipelineRunResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listProjects()
      .then((data) => {
        setProjects(data.projects);
        if (data.projects[0]) {
          setProjectId(data.projects[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setWorkforceStatus(null);
      setSteps([]);
      return;
    }

    setLoadingDomains(true);
    getProjectDomains(projectId)
      .then((status) => {
        setWorkforceStatus(status);
        setError('');
      })
      .catch((err) => {
        setWorkforceStatus(null);
        setError(err instanceof Error ? err.message : 'Unable to load project workforces.');
      })
      .finally(() => setLoadingDomains(false));
  }, [projectId]);

  const compatibleTemplates = useMemo(() => getCompatibleTemplates(workforceStatus), [workforceStatus]);

  useEffect(() => {
    setSelectedTemplateId((current) => {
      if (compatibleTemplates.some((template) => template.id === current)) {
        return current;
      }
      return compatibleTemplates[0]?.id || '';
    });

    setSteps((current) => {
      if (workforceStatus) {
        const validSteps = current.filter((step) => workforceStatus.agents[step.workforce]?.includes(step.agent_id));
        if (validSteps.length > 0) {
          return validSteps.map(cloneStep);
        }
      }

      if (compatibleTemplates[0]) {
        return compatibleTemplates[0].steps.map(cloneStep);
      }

      const fallbackStep = buildFallbackStep(workforceStatus);
      return fallbackStep ? [fallbackStep] : [];
    });
  }, [compatibleTemplates, workforceStatus]);

  const activeWorkforces = workforceStatus?.active_workforces ?? [];
  const availableAgents = workforceStatus?.agents ?? {};

  const applyTemplate = (templateId: string) => {
    const template = compatibleTemplates.find((item) => item.id === templateId);
    if (!template) {
      return;
    }
    setSelectedTemplateId(template.id);
    setSteps(template.steps.map(cloneStep));
    setResult(null);
  };

  const addStep = () => {
    const fallbackStep = buildFallbackStep(workforceStatus);
    if (!fallbackStep) {
      return;
    }
    setSteps((current) => [...current, fallbackStep]);
  };

  const updateStep = (index: number, nextStep: PipelineBuilderStep) => {
    setSteps((current) => current.map((step, stepIndex) => (stepIndex === index ? nextStep : step)));
  };

  const handleWorkforceChange = (index: number, workforce: string) => {
    const nextAgentId = availableAgents[workforce]?.[0];
    if (!nextAgentId) {
      return;
    }
    updateStep(index, buildStep(workforce, nextAgentId));
  };

  const handleAgentChange = (index: number, workforce: string, agentId: string) => {
    updateStep(index, buildStep(workforce, agentId));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setSteps((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(targetIndex, 0, step);
      return next;
    });
  };

  const removeStep = (index: number) => {
    setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index));
  };

  const handleRun = async () => {
    if (!projectId || steps.length === 0) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await runProjectCustomPipeline(projectId, {
        task,
        steps,
        context: {
          launched_from: 'pipeline_builder_page',
          template: selectedTemplateId || 'manual',
        },
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
      <section className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Pipeline Builder</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Assemble writing, media, promo, and coordination workforces into a project-specific execution graph.
            </p>
          </div>
          {loadingDomains && <span className="text-xs text-slate-500">Refreshing workforces…</span>}
        </div>

        <label className="block text-sm text-slate-300">
          Project
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
          >
            <option value="">Select a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} ({project.domains.join(', ')})
              </option>
            ))}
          </select>
        </label>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Active Workforces</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {activeWorkforces.map((workforce) => (
              <span key={workforce} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
                {workforce}
              </span>
            ))}
            {activeWorkforces.length === 0 && <span className="text-sm text-slate-500">Select a project to load builder options.</span>}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-white">Templates</h3>
            {selectedTemplateId && <span className="text-xs text-slate-500">Current template: {selectedTemplateId}</span>}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {compatibleTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => applyTemplate(template.id)}
                className={`rounded-2xl border p-4 text-left transition ${
                  template.id === selectedTemplateId
                    ? 'border-amber-400 bg-amber-400/15 text-amber-100'
                    : 'border-slate-800 bg-slate-950/70 text-slate-300'
                }`}
              >
                <p className="font-medium">{template.title}</p>
                <p className="mt-2 text-sm text-slate-400">{template.description}</p>
              </button>
            ))}
            {compatibleTemplates.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-500">
                No preset template matches this project’s active workforces yet.
              </div>
            )}
          </div>
        </div>

        <label className="block text-sm text-slate-300">
          Objective
          <textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            className="mt-2 min-h-32 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
          />
        </label>

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-white">Pipeline Graph</h3>
            <button
              type="button"
              onClick={addStep}
              disabled={!projectId || activeWorkforces.length === 0}
              className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
            >
              Add Step
            </button>
          </div>

          <div className="space-y-4">
            {steps.map((step, index) => {
              const agentOptions = availableAgents[step.workforce] ?? [];
              const agentTemplate = findAgentTemplate(step.workforce, step.agent_id);

              return (
                <div key={`${step.workforce}-${step.agent_id}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Step {index + 1}</p>
                      <p className="mt-1 text-sm text-slate-300">{agentTemplate?.role || 'Custom workflow stage'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => moveStep(index, -1)}
                        disabled={index === 0}
                        className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStep(index, 1)}
                        disabled={index === steps.length - 1}
                        className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white disabled:opacity-50"
                      >
                        Down
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStep(index)}
                        disabled={steps.length === 1}
                        className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-rose-500 hover:text-rose-200 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="block text-xs text-slate-400">
                      Workforce
                      <select
                        value={step.workforce}
                        onChange={(event) => handleWorkforceChange(index, event.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      >
                        {activeWorkforces.map((workforce) => (
                          <option key={workforce} value={workforce}>
                            {workforce}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-xs text-slate-400">
                      Agent
                      <select
                        value={step.agent_id}
                        onChange={(event) => handleAgentChange(index, step.workforce, event.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      >
                        {agentOptions.map((agentId) => (
                          <option key={agentId} value={agentId}>
                            {agentId}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-xs text-slate-400 lg:col-span-2">
                      Step Description
                      <input
                        value={step.description || ''}
                        onChange={(event) => updateStep(index, { ...step, description: event.target.value })}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                    </label>

                    <label className="block text-xs text-slate-400">
                      Artifact Type
                      <input
                        value={step.artifact_type || ''}
                        onChange={(event) => updateStep(index, { ...step, artifact_type: event.target.value || null })}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                        placeholder="Optional"
                      />
                    </label>

                    <label className="block text-xs text-slate-400">
                      Gate Input Artifact
                      <input
                        value={step.gate_input_artifact || ''}
                        onChange={(event) => updateStep(index, { ...step, gate_input_artifact: event.target.value || null })}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                        placeholder="artifact_type"
                      />
                    </label>

                    <label className="block text-xs text-slate-400 lg:col-span-2">
                      Required Artifacts
                      <input
                        value={step.requires_artifacts.join(', ')}
                        onChange={(event) => updateStep(index, { ...step, requires_artifacts: parseArtifacts(event.target.value) })}
                        className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                        placeholder="execution_brief, script, video_critique"
                      />
                    </label>
                  </div>

                  <label className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={step.is_gate}
                      onChange={(event) => updateStep(index, { ...step, is_gate: event.target.checked })}
                      className="rounded border-slate-700 bg-slate-900 text-amber-400"
                    />
                    Treat this step as a blocking gate.
                  </label>
                </div>
              );
            })}
          </div>
        </div>

        {error && <p className="text-sm text-rose-300">{error}</p>}

        <button
          onClick={handleRun}
          disabled={!projectId || loading || steps.length === 0}
          className="rounded-full bg-amber-400 px-5 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
        >
          {loading ? 'Running…' : 'Run Builder'}
        </button>
      </section>

      <section className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Execution Output</h2>
          <p className="mt-2 text-sm text-slate-400">
            The coordinating graph writes each result back into the shared artifact chain as it runs.
          </p>
        </div>

        {!result && <p className="text-sm text-slate-500">Run the builder to inspect plan results, gates, and final output.</p>}

        {result && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
                  {result.plan.pipeline_kind}
                </span>
                <span className={`rounded-full px-2 py-1 text-xs ${result.success ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
                  {result.success ? 'success' : 'failed'}
                </span>
                <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-400">
                  {result.results.length} steps
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{result.final_output || 'No final output.'}</p>
            </div>

            <div className="space-y-3">
              {result.results.map((step) => (
                <div key={`${step.step_num}-${step.agent}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium text-white">
                      Step {step.step_num}: {step.agent}
                    </p>
                    {step.artifact_type && <span className="text-xs text-slate-500">{step.artifact_type}</span>}
                  </div>
                  <p className="mt-2 text-sm text-slate-400">{step.description}</p>
                  <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-300">{step.content}</pre>
                  {step.gate_result && (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 p-3 text-sm">
                      <p className={step.gate_result.verdict.passed ? 'text-emerald-300' : 'text-rose-300'}>
                        {step.gate_result.verdict.passed ? 'Gate passed' : 'Gate failed'}: {step.gate_result.verdict.reason}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
