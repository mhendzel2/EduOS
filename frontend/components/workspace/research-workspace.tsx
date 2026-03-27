'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowPathIcon,
  BeakerIcon,
  BoltIcon,
  CheckBadgeIcon,
  CircleStackIcon,
  CpuChipIcon,
  FolderOpenIcon,
  MagnifyingGlassIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import Card from '@/components/ui/card';
import Button from '@/components/ui/button';
import OllamaQuickstart from '@/components/runtime/ollama-quickstart';
import DocumentUpload from '@/components/upload/document-upload';
import {
  fetchHealth,
  getConsensus,
  listAgentCatalog,
  listProjects,
  searchDocuments,
  streamPipeline,
  streamTask,
} from '@/lib/api';
import type {
  ConsensusResponse,
  HealthResponse,
  PipelineResponse,
  Project,
  RunStreamEvent,
  SearchResultItem,
  TaskResponse,
  AgentCatalogEntry,
} from '@/lib/types';

type WorkspaceMode = 'assistant' | 'consensus' | 'pipeline';
type WorkspaceMessageRole = 'user' | 'assistant' | 'system';

interface WorkspaceMessage {
  id: string;
  role: WorkspaceMessageRole;
  title: string;
  content: string;
  meta?: string;
}

interface RunSummary {
  title: string;
  detail: string;
  metadata: Array<{ label: string; value: string }>;
  steps: Array<{ label: string; detail: string; success?: boolean }>;
}

const MODE_OPTIONS: Array<{
  value: WorkspaceMode;
  title: string;
  description: string;
  icon: typeof SparklesIcon;
}> = [
  {
    value: 'assistant',
    title: 'Research Partner',
    description: 'Structured AI assistance for drafting, synthesis, and project planning.',
    icon: SparklesIcon,
  },
  {
    value: 'consensus',
    title: 'Reviewer Sweep',
    description: 'Cross-check claims, language, and interpretation across multiple models.',
    icon: CheckBadgeIcon,
  },
  {
    value: 'pipeline',
    title: 'Deterministic Analysis',
    description: 'Planner-led multi-agent execution aligned to reproducible analysis workflows.',
    icon: BoltIcon,
  },
];

const SURFACES: Array<{
  name: string;
  detail: string;
  /** URI protocol to launch local desktop app, or web URL */
  href: string;
  /** 'protocol' = desktop app via URI scheme, 'url' = opens in new tab */
  linkType: 'protocol' | 'url' | 'internal';
  group: 'microsoft' | 'google' | 'platform';
}> = [
  // ── Microsoft Office (local desktop via URI protocol handlers) ──
  { name: 'Word', detail: 'Manuscripts, grants, reviewer responses, figure-aware drafting.', href: 'ms-word:', linkType: 'protocol', group: 'microsoft' },
  { name: 'PowerPoint', detail: 'Slides, speaker notes, backup slides, figure reuse.', href: 'ms-powerpoint:', linkType: 'protocol', group: 'microsoft' },
  { name: 'Excel', detail: 'Dataset staging, trigger reproducible analyses, preview outputs.', href: 'ms-excel:', linkType: 'protocol', group: 'microsoft' },
  { name: 'Outlook', detail: 'Deadlines, reviewer mail, project-linked communication.', href: 'ms-outlook:', linkType: 'protocol', group: 'microsoft' },
  { name: 'Teams', detail: 'Project threads, artifact sharing, experiment-linked discussion.', href: 'msteams:', linkType: 'protocol', group: 'microsoft' },
  // ── Google Workspace (web apps) ──
  { name: 'Google Docs', detail: 'Collaborative manuscript drafting and shared commenting.', href: 'https://docs.google.com/document/u/0/', linkType: 'url', group: 'google' },
  { name: 'Google Sheets', detail: 'Shared datasets, charts, and collaborative data entry.', href: 'https://docs.google.com/spreadsheets/u/0/', linkType: 'url', group: 'google' },
  { name: 'Google Slides', detail: 'Collaborative presentations and figure-based slide decks.', href: 'https://docs.google.com/presentation/u/0/', linkType: 'url', group: 'google' },
  { name: 'Google Drive', detail: 'Shared file storage, project folders, and team access.', href: 'https://drive.google.com/', linkType: 'url', group: 'google' },
  // ── Platform ──
  { name: 'Web Control Center', detail: 'Projects, provenance, execution logs, figures, and governance.', href: '/workspace', linkType: 'internal', group: 'platform' },
];

const FALLBACK_AGENT_OPTIONS = [
  { value: 'supervisor', label: 'Workflow Orchestrator', description: 'Coordinate evidence, drafting, and critique.' },
  { value: 'evidence_librarian', label: 'Evidence Librarian', description: 'Curate query plans, sources, and reading order.' },
  { value: 'deep_research', label: 'Deep Research Analyst', description: 'Run retrieval-backed literature review.' },
  { value: 'report_writer', label: 'Report Writer', description: 'Draft sections, reviews, and grant text from evidence.' },
  { value: 'claim_auditor', label: 'Claim Auditor', description: 'Map claims to evidence and flag support gaps.' },
  { value: 'manuscript_critic', label: 'Manuscript Critic', description: 'Critique argument quality and revision priorities.' },
  { value: 'reviewer_response_strategist', label: 'Reviewer Response Strategist', description: 'Turn reviewer comments into a rebuttal plan.' },
  { value: 'research', label: 'Research Generalist', description: 'General literature review and topic explanation.' },
  { value: 'summarizer', label: 'Section Condenser', description: 'Compress long outputs into concise summaries.' },
  { value: 'synthesizer', label: 'Narrative Synthesizer', description: 'Combine multiple evidence strands into one narrative.' },
  { value: 'verifier', label: 'Consistency Checker', description: 'Run general verification and confidence checks.' },
  { value: 'bioinformatics', label: 'Methods Specialist', description: 'Design and review bioinformatics workflows.' },
  { value: 'code', label: 'Analysis Appendix Agent', description: 'Generate code and analysis scripts.' },
];

const MODEL_OPTIONS = [
  // Google (direct API — configured)
  { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
  { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { value: 'google/gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  // Free via OpenRouter
  { value: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B (free)' },
  { value: 'qwen/qwen3-coder:free', label: 'Qwen 3 Coder (free)' },
  { value: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small 3.1 (free)' },
  // Ollama (local)
  { value: 'ollama/llama3.2', label: 'Ollama: Llama 3.2' },
  { value: 'ollama/mistral', label: 'Ollama: Mistral' },
];

const PIPELINE_PATTERN = [
  'Jarvis interprets intent and builds a governed task sequence.',
  'Jules prepares deterministic analysis context and validates execution boundaries.',
  'The pipeline runs, records provenance, and produces reusable outputs for figures and writing.',
];

const GOVERNANCE_RULES = [
  'Deterministic execution by default',
  'Sandboxed analysis with no network side effects',
  'Allowed scientific stack only: pandas, numpy, scipy, statsmodels, scikit-learn, plotly',
  'Outputs are provenance-ready and re-runnable',
];

const INITIAL_MESSAGES: WorkspaceMessage[] = [
  {
    id: 'intro',
    role: 'assistant',
    title: 'Research OS Control Center',
    content:
      'This surface unifies project context, drafting, reproducible analysis, figure generation, and provenance review into one workspace for scientific work.',
    meta: 'Jarvis orchestrates the workflow. Jules governs deterministic analysis.',
  },
];

function createMessage(role: WorkspaceMessageRole, title: string, content: string, meta?: string): WorkspaceMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    title,
    content,
    meta,
  };
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function toMetadataEntries(record: Record<string, unknown>): Array<{ label: string; value: string }> {
  return Object.entries(record)
    .slice(0, 4)
    .map(([label, value]) => ({
      label: label.replace(/_/g, ' '),
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
}

function summarizeTaskResponse(response: TaskResponse, durationMs: number): RunSummary {
  return {
    title: 'Writing or planning pass complete',
    detail: `Jarvis completed a ${response.agent_used} run in ${formatDuration(durationMs)}.`,
    metadata: [
      { label: 'Agent', value: response.agent_used },
      { label: 'Duration', value: formatDuration(durationMs) },
      ...toMetadataEntries(response.metadata),
    ],
    steps: Object.entries(response.metadata || {}).slice(0, 3).map(([label, value]) => ({
      label: label.replace(/_/g, ' '),
      detail: typeof value === 'string' ? value : JSON.stringify(value),
      success: true,
    })),
  };
}

function summarizeConsensusResponse(response: ConsensusResponse, durationMs: number): RunSummary {
  return {
    title: 'Reviewer sweep complete',
    detail: `${Object.keys(response.responses).length} model perspectives compared in ${formatDuration(durationMs)}.`,
    metadata: [
      { label: 'Agreement', value: formatScore(response.agreement_score) },
      { label: 'Models', value: `${Object.keys(response.responses).length}` },
      { label: 'Duration', value: formatDuration(durationMs) },
      ...toMetadataEntries(response.metadata),
    ],
    steps: Object.entries(response.responses).map(([model, content]) => ({
      label: model,
      detail: content.slice(0, 160),
      success: true,
    })),
  };
}

function summarizePipelineResponse(response: PipelineResponse, durationMs: number): RunSummary {
  const plan = (response.plan || {}) as {
    steps?: Array<{ step_num?: number; agent_name?: string; description?: string }>;
    task_type?: string;
    estimated_tokens?: number | string;
  };
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const resultSteps = Object.values(response.results || {}) as Array<{
    step_num?: number;
    description?: string;
    success?: boolean;
  }>;
  return {
    title: 'Deterministic analysis run complete',
    detail: `${steps.length} planned steps executed with provenance-ready output in ${formatDuration(durationMs)}.`,
    metadata: [
      { label: 'Task type', value: String(plan.task_type || 'pipeline') },
      { label: 'Planned steps', value: `${steps.length}` },
      { label: 'Estimated tokens', value: `${plan.estimated_tokens ?? 'unknown'}` },
      { label: 'Duration', value: formatDuration(durationMs) },
    ],
    steps: steps.map((step) => {
      const result = resultSteps.find((entry) => entry.step_num === step.step_num);
      return {
        label: `${step.step_num}. ${step.agent_name}`,
        detail: result?.description || step.description || 'Completed',
        success: result?.success,
      };
    }),
  };
}

function summarizeStreamEvent(event: RunStreamEvent): RunSummary['steps'][number] | null {
  const payload = event.payload || {};

  switch (event.event_type) {
    case 'run.created':
      return {
        label: 'Run queued',
        detail: `Prepared ${String(payload.run_type || 'execution')} run`,
      };
    case 'run.started':
      return {
        label: 'Coordinator active',
        detail: `Using ${String(payload.coordinator || 'local')} coordinator`,
      };
    case 'task.agent.started':
      return {
        label: `${String(payload.agent || 'agent')} started`,
        detail: 'The specialist is preparing a response.',
      };
    case 'task.agent.completed':
      return {
        label: `${String(payload.agent || 'agent')} completed`,
        detail: `Model ${String(payload.model_used || 'unknown')} returned a response.`,
        success: Boolean(payload.success),
      };
    case 'pipeline.planned':
      return {
        label: 'Plan created',
        detail: `${Array.isArray(payload.steps) ? payload.steps.length : 0} pipeline steps scheduled.`,
      };
    case 'pipeline.step.started':
      return {
        label: `Step ${String(payload.step_num || '?')} started`,
        detail: `${String(payload.agent_name || 'agent')}: ${String(payload.description || '')}`,
      };
    case 'pipeline.step.completed':
      return {
        label: `Step ${String(payload.step_num || '?')} completed`,
        detail: `${String(payload.agent_name || 'agent')}: ${String(payload.description || '')}`,
        success: payload.success === undefined ? true : Boolean(payload.success),
      };
    case 'pipeline.step.failed':
      return {
        label: `Step ${String(payload.step_num || '?')} failed`,
        detail: String(payload.error || 'Pipeline step failed'),
        success: false,
      };
    case 'run.completed':
      return {
        label: 'Run completed',
        detail: 'Final output is ready.',
        success: Boolean(payload.success),
      };
    case 'run.failed':
      return {
        label: 'Run failed',
        detail: String(payload.error || 'Execution failed'),
        success: false,
      };
    default:
      return null;
  }
}

export default function ResearchWorkspace() {
  const [mode, setMode] = useState<WorkspaceMode>('assistant');
  const [selectedAgent, setSelectedAgent] = useState('supervisor');
  const [selectedModels, setSelectedModels] = useState<string[]>([
    'google/gemini-2.5-flash',
  ]);
  const [task, setTask] = useState('');
  const [messages, setMessages] = useState<WorkspaceMessage[]>(INITIAL_MESSAGES);
  const [projects, setProjects] = useState<Project[]>([]);
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogEntry[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('default');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [lastRun, setLastRun] = useState<RunSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const agentOptions = (
    agentCatalog.length > 0
      ? agentCatalog
          .filter((agent) => agent.is_active)
          .map((agent) => ({
            value: agent.name,
            label: agent.display_name,
            description: agent.description,
          }))
      : FALLBACK_AGENT_OPTIONS
  );
  const selectedAgentInfo = agentOptions.find((agent) => agent.value === selectedAgent) || FALLBACK_AGENT_OPTIONS[0];

  useEffect(() => {
    let mounted = true;

    async function loadWorkspace() {
      try {
        const [healthResponse, projectResponse, customAgentResponse] = await Promise.all([
          fetchHealth(),
          listProjects(),
          listAgentCatalog(),
        ]);
        if (!mounted) {
          return;
        }
        setHealth(healthResponse);
        setProjects(projectResponse);
        setAgentCatalog(customAgentResponse);
        setBootError(null);
      } catch (err) {
        if (!mounted) {
          return;
        }
        setBootError(err instanceof Error ? err.message : 'Failed to load workspace context');
      }
    }

    loadWorkspace();
    const interval = window.setInterval(loadWorkspace, 30000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!agentOptions.some((agent) => agent.value === selectedAgent)) {
      setSelectedAgent('supervisor');
    }
  }, [agentOptions, selectedAgent]);

  const selectedProject =
    selectedProjectId === 'default'
      ? { id: 'default', name: 'Workspace Inbox', description: 'Shared intake for cross-project scientific work.' }
      : projects.find((project) => project.id === selectedProjectId) || null;

  const context: Record<string, unknown> = {
    project_id: selectedProjectId,
    execution_surface: 'research_os_control_center',
    execution_mode: mode,
  };

  async function handleRun() {
    const prompt = task.trim();
    if (!prompt) {
      return;
    }

    const startedAt = Date.now();
    setLoading(true);
    setError(null);
    setMessages((previous) => [
      ...previous,
      createMessage('user', 'Research request', prompt, MODE_OPTIONS.find((item) => item.value === mode)?.title),
    ]);
    setTask('');

    try {
      if (mode === 'assistant') {
        const streamedSteps: RunSummary['steps'] = [];
        setLastRun({
          title: 'Live orchestration in progress',
          detail: 'Streaming coordinator and agent events into the workspace.',
          metadata: [
            { label: 'Mode', value: 'assistant' },
            { label: 'Project', value: selectedProject?.name || 'Workspace Inbox' },
          ],
          steps: [],
        });

        const response = await streamTask(prompt, context, selectedAgent, (event) => {
          const step = summarizeStreamEvent(event);
          if (!step) {
            return;
          }
          streamedSteps.push(step);
          setLastRun((previous) => ({
            title: previous?.title || 'Live orchestration in progress',
            detail: previous?.detail || 'Streaming coordinator and agent events into the workspace.',
            metadata: previous?.metadata || [],
            steps: [...streamedSteps],
          }));
        });
        const durationMs = Date.now() - startedAt;
        const summary = summarizeTaskResponse(response, durationMs);
        setLastRun({
          ...summary,
          steps: streamedSteps.length > 0 ? streamedSteps : summary.steps,
        });
        setMessages((previous) => [
          ...previous,
          createMessage(
            'assistant',
            `${agentOptions.find((item) => item.value === response.agent_used)?.label || response.agent_used} output`,
            response.result,
            `Completed in ${formatDuration(durationMs)}`,
          ),
        ]);
        return;
      }

      if (mode === 'consensus') {
        const response = await getConsensus(prompt, selectedModels, context);
        const durationMs = Date.now() - startedAt;
        setLastRun(summarizeConsensusResponse(response, durationMs));
        setMessages((previous) => [
          ...previous,
          createMessage(
            'assistant',
            'Reviewer sweep synthesis',
            response.consensus,
            `Agreement score ${formatScore(response.agreement_score)}`,
          ),
        ]);
        return;
      }

      const streamedSteps: RunSummary['steps'] = [];
      setLastRun({
        title: 'Deterministic analysis in progress',
        detail: 'Streaming planner and pipeline events as the run advances.',
        metadata: [
          { label: 'Mode', value: 'pipeline' },
          { label: 'Project', value: selectedProject?.name || 'Workspace Inbox' },
        ],
        steps: [],
      });

      const response = await streamPipeline(prompt, context, [], (event) => {
        const step = summarizeStreamEvent(event);
        if (!step) {
          return;
        }
        streamedSteps.push(step);
        setLastRun((previous) => ({
          title: previous?.title || 'Deterministic analysis in progress',
          detail: previous?.detail || 'Streaming planner and pipeline events as the run advances.',
          metadata: previous?.metadata || [],
          steps: [...streamedSteps],
        }));
      });
      const durationMs = Date.now() - startedAt;
      const summary = summarizePipelineResponse(response, durationMs);
      setLastRun({
        ...summary,
        steps: streamedSteps.length > 0 ? streamedSteps : summary.steps,
      });
      setMessages((previous) => [
        ...previous,
        createMessage(
          'assistant',
          'Deterministic analysis output',
          response.final_output,
          `${Array.isArray((response.plan as { steps?: unknown[] })?.steps) ? (response.plan as { steps?: unknown[] }).steps?.length : 0} planned steps completed`,
        ),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Research execution failed';
      setError(message);
      setMessages((previous) => [...previous, createMessage('system', 'Execution error', message)]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    const query = searchQuery.trim();
    if (!query) {
      return;
    }

    setSearching(true);
    setError(null);

    try {
      const response = await searchDocuments(
        query,
        selectedProjectId === 'default' ? undefined : selectedProjectId,
      );
      setSearchResults(response.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  function toggleModel(modelValue: string) {
    setSelectedModels((previous) =>
      previous.includes(modelValue)
        ? previous.filter((model) => model !== modelValue)
        : [...previous, modelValue]
    );
  }

  const agentCount = health?.agents.length || 0;
  const totalDocuments = projects.reduce((sum, project) => sum + (project.document_count || 0), 0);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_380px]">
      <div className="space-y-6">
        <Card className="overflow-hidden border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-0">
          <div className="border-b border-slate-800/80 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.16),_transparent_42%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.12),_transparent_32%)] px-6 py-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/80">
                  Unified web control center
                </p>
                <h1 className="mt-2 text-3xl font-bold text-white">Research OS Control Center</h1>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Manage experiments, datasets, deterministic analyses, figures, manuscripts, and provenance from a
                  single scientific workspace that mirrors the end-to-end Research OS lifecycle.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Projects</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{projects.length}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Indexed docs</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{totalDocuments}</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Agents online</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{agentCount}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="px-6 py-5">
            <OllamaQuickstart />
          </div>
        </Card>

        <Card
          title="Research Surfaces"
          description="The OS enhances the tools researchers already use instead of forcing a parallel system. Click to launch."
        >
          {/* Microsoft Office – local desktop apps */}
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Microsoft Office</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {SURFACES.filter((s) => s.group === 'microsoft').map((surface) => (
              <a
                key={surface.name}
                href={surface.href}
                className="group rounded-2xl border border-slate-800 bg-slate-950 px-4 py-4 transition-all hover:border-blue-600 hover:bg-blue-600/10 cursor-pointer"
              >
                <p className="font-semibold text-white group-hover:text-blue-300">{surface.name}</p>
                <p className="mt-2 text-sm text-slate-400">{surface.detail}</p>
                <p className="mt-2 text-[10px] text-slate-600">Opens desktop app</p>
              </a>
            ))}
          </div>

          {/* Google Workspace – web apps */}
          <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Google Workspace</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {SURFACES.filter((s) => s.group === 'google').map((surface) => (
              <a
                key={surface.name}
                href={surface.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group rounded-2xl border border-slate-800 bg-slate-950 px-4 py-4 transition-all hover:border-emerald-600 hover:bg-emerald-600/10 cursor-pointer"
              >
                <p className="font-semibold text-white group-hover:text-emerald-300">{surface.name}</p>
                <p className="mt-2 text-sm text-slate-400">{surface.detail}</p>
                <p className="mt-2 text-[10px] text-slate-600">Opens in browser ↗</p>
              </a>
            ))}
          </div>

          {/* Platform */}
          <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Platform</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {SURFACES.filter((s) => s.group === 'platform').map((surface) => (
              <Link
                key={surface.name}
                href={surface.href}
                className="group rounded-2xl border border-slate-800 bg-slate-950 px-4 py-4 transition-all hover:border-cyan-600 hover:bg-cyan-600/10 cursor-pointer"
              >
                <p className="font-semibold text-white group-hover:text-cyan-300">{surface.name}</p>
                <p className="mt-2 text-sm text-slate-400">{surface.detail}</p>
              </Link>
            ))}
          </div>
        </Card>

        <Card
          title="Execution Modes"
          description="One command surface, tuned for partner-style drafting, reviewer validation, and reproducible analysis."
        >
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {MODE_OPTIONS.map((option) => {
              const isActive = option.value === mode;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMode(option.value)}
                  className={`rounded-2xl border p-4 text-left transition-all ${
                    isActive
                      ? 'border-cyan-400/50 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.15)]'
                      : 'border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`rounded-xl p-2 ${isActive ? 'bg-cyan-400/15 text-cyan-300' : 'bg-slate-800 text-slate-400'}`}>
                      <option.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-white">{option.title}</p>
                      <p className="mt-1 text-sm text-slate-400">{option.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card
          title="Command Surface"
          description="Use the same prompt surface for writing, critique, analysis planning, and governed execution."
        >
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <textarea
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder="Draft a results section, critique a figure claim, plan a deterministic analysis, or prepare reviewer responses."
                rows={7}
                className="w-full rounded-2xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm leading-6 text-slate-100 placeholder-slate-500 focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />

              {mode === 'assistant' && (
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-slate-300">Primary agent</label>
                  <select
                    title="Primary agent"
                    value={selectedAgent}
                    onChange={(event) => setSelectedAgent(event.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                  >
                    {agentOptions.map((agent) => (
                      <option key={agent.value} value={agent.value}>
                        {agent.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    {selectedAgentInfo?.description}
                  </p>
                </div>
              )}

              {mode === 'consensus' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-slate-300">Reviewer models</label>
                    <span className="text-xs text-slate-500">Use multiple perspectives before committing copy</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {MODEL_OPTIONS.map((model) => (
                      <label
                        key={model.value}
                        className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm hover:border-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={selectedModels.includes(model.value)}
                          onChange={() => toggleModel(model.value)}
                          className="mt-0.5 h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-400"
                        />
                        <span className="text-slate-300">{model.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {mode === 'pipeline' && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
                  <p className="text-sm font-medium text-white">Deterministic workflow pattern</p>
                  <div className="mt-3 space-y-2">
                    {PIPELINE_PATTERN.map((step, index) => (
                      <div key={step} className="flex gap-3 text-sm text-slate-400">
                        <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-cyan-400/15 text-xs font-semibold text-cyan-300">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={handleRun} loading={loading} className="bg-cyan-500 text-slate-950 hover:bg-cyan-400">
                  <SparklesIcon className="h-4 w-4" />
                  Run Research Pass
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMessages(INITIAL_MESSAGES);
                    setLastRun(null);
                    setError(null);
                  }}
                >
                  <ArrowPathIcon className="h-4 w-4" />
                  Reset Session
                </Button>
                <Link href="/pipeline" className="text-sm font-medium text-cyan-300 transition-colors hover:text-cyan-200">
                  Open analysis studio
                </Link>
              </div>

              {error && (
                <div className="rounded-xl border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-sm font-semibold text-white">Run context</p>
              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <label className="mb-2 block font-medium text-slate-300">Project workspace</label>
                  <select
                    title="Project workspace"
                    value={selectedProjectId}
                    onChange={(event) => setSelectedProjectId(event.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
                  >
                    <option value="default">Workspace Inbox</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current target</p>
                  <p className="mt-2 font-medium text-white">{selectedProject?.name || 'Workspace Inbox'}</p>
                  <p className="mt-1 text-slate-400">
                    {selectedProject?.description || 'Use the shared inbox for cross-project drafting, intake, and exploratory work.'}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Workflow anchor</p>
                  <p className="mt-2 text-slate-400">
                    Projects connect experiments, datasets, analyses, figures, manuscripts, presentations, and submissions.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="Research Session"
          description="A single session log keeps requests, outputs, and failures visible across writing and analysis work."
        >
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-2xl border px-4 py-4 ${
                  message.role === 'user'
                    ? 'border-cyan-400/30 bg-cyan-500/10'
                    : message.role === 'system'
                      ? 'border-amber-500/30 bg-amber-500/10'
                      : 'border-slate-800 bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-white">{message.title}</p>
                  {message.meta && <p className="text-xs text-slate-400">{message.meta}</p>}
                </div>
                <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">
                  {message.content}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card
          title="Governance Rail"
          description="Runtime status, provenance posture, and scientific execution rules stay visible while you work."
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
              <div className="flex items-center gap-3">
                <CpuChipIcon className="h-5 w-5 text-cyan-300" />
                <div>
                  <p className="text-sm font-medium text-white">Backend health</p>
                  <p className="text-xs text-slate-500">Research orchestration runtime</p>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  health?.status === 'healthy'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {health?.status || 'loading'}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">API version</p>
                <p className="mt-2 text-lg font-semibold text-white">{health?.version || 'v1'}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Coordinator</p>
                <p className="mt-2 text-lg font-semibold text-white">{health?.coordinator?.provider || 'local'}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Agents</p>
                <p className="mt-2 text-lg font-semibold text-white">{agentCount}</p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-4">
              <div className="flex items-center gap-2">
                <CircleStackIcon className="h-5 w-5 text-emerald-300" />
                <p className="text-sm font-medium text-white">Scientific guardrails</p>
              </div>
              <div className="mt-3 space-y-2">
                {GOVERNANCE_RULES.map((rule) => (
                  <div key={rule} className="text-sm text-slate-400">
                    {rule}
                  </div>
                ))}
              </div>
            </div>

            {bootError && (
              <div className="rounded-xl border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
                {bootError}
              </div>
            )}
          </div>
        </Card>

        <Card
          title="Provenance Snapshot"
          description="Every run should be explainable from inputs to outputs."
        >
          {lastRun ? (
            <div className="space-y-4">
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-500/10 p-4">
                <p className="text-sm font-semibold text-white">{lastRun.title}</p>
                <p className="mt-1 text-sm text-slate-300">{lastRun.detail}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {lastRun.metadata.map((entry) => (
                  <div key={`${entry.label}-${entry.value}`} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{entry.label}</p>
                    <p className="mt-2 text-sm font-medium text-white">{entry.value}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                {lastRun.steps.length > 0 ? (
                  lastRun.steps.map((step) => (
                    <div key={`${step.label}-${step.detail}`} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-white">{step.label}</p>
                        {step.success !== undefined && (
                          <span className={`text-xs font-medium ${step.success ? 'text-emerald-300' : 'text-red-300'}`}>
                            {step.success ? 'validated' : 'flagged'}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm text-slate-400">{step.detail}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950 px-3 py-6 text-center text-sm text-slate-500">
                    No trace entries returned for the last run.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950 px-4 py-8 text-center">
              <CheckBadgeIcon className="mx-auto h-10 w-10 text-slate-700" />
              <p className="mt-3 text-sm text-slate-400">
                Run a pass to populate provenance metadata and execution checkpoints here.
              </p>
            </div>
          )}
        </Card>

        <Card
          title="Evidence Recall"
          description="Search documents and notes while drafting or validating claims."
        >
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search uploaded papers, methods, and notes"
                className="flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
              <Button variant="secondary" onClick={handleSearch} loading={searching}>
                <MagnifyingGlassIcon className="h-4 w-4" />
                Search
              </Button>
            </div>

            {searchResults.length > 0 ? (
              <div className="space-y-2">
                {searchResults.map((result) => (
                  <div key={`${result.document_id}-${result.score}`} className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">
                        {(result.metadata.filename as string) || result.document_id}
                      </p>
                      <span className="text-xs text-cyan-300">score {result.score.toFixed(2)}</span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">{result.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950 px-4 py-6 text-center text-sm text-slate-500">
                Search results will appear here.
              </div>
            )}
          </div>
        </Card>

        <Card
          title="Project Intake"
          description="Bring new evidence into the workspace so it can flow into analysis, figures, and writing."
        >
          <div className="space-y-4">
            {uploadStatus && (
              <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-300">
                {uploadStatus}
              </div>
            )}
            <DocumentUpload
              projectId={selectedProjectId}
              onUploadSuccess={(_, filename) =>
                setUploadStatus(`Indexed ${filename} into ${selectedProject?.name || 'Workspace Inbox'}.`)
              }
            />
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <FolderOpenIcon className="h-4 w-4 text-slate-500" />
                <span>Need a formal project workspace first?</span>
              </div>
              <Link href="/dashboard" className="font-medium text-cyan-300 hover:text-cyan-200">
                Open project workspace
              </Link>
            </div>
          </div>
        </Card>

        <Card
          title="Jarvis & Jules"
          description="The division of responsibilities behind the Research OS."
        >
          <div className="space-y-3 text-sm text-slate-400">
            <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
              <SparklesIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-cyan-300" />
              <p><span className="font-medium text-white">Jarvis</span> interprets intent, coordinates agents, routes tasks, and manages workflow state.</p>
            </div>
            <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
              <BeakerIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-300" />
              <p><span className="font-medium text-white">Jules</span> governs code task plans, validates analysis rules, and prepares sandbox execution.</p>
            </div>
            <div className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
              <CircleStackIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-300" />
              <p><span className="font-medium text-white">Provenance</span> links experiments, data, code, execution, figures, and manuscript outputs into one ledger.</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
