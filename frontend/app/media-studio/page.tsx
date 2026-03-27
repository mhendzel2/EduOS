'use client';

import { useEffect, useState } from 'react';
import ProjectChatPanel from '@/components/chat/project-chat-panel';
import {
  executeProjectMediaToolAction,
  getArtifacts,
  getProjectMediaTools,
  listProjectDocuments,
  listProjects,
  runProjectAgent,
  updateProjectMediaTools,
} from '@/lib/api';
import type {
  AgentResponsePayload,
  Artifact,
  GateVerdict,
  MediaToolActionResponse,
  MediaToolSettingsItem,
  ProjectChatResponse,
  ProjectDocumentItem,
  ProjectMediaToolSettings,
  StudioProject,
} from '@/lib/types';

const STAGES = [
  { label: 'Direction', workforce: 'coordination', agentId: 'director', artifactType: 'execution_brief', isGate: false },
  { label: 'Research', workforce: 'media', agentId: 'research', artifactType: 'research_brief', isGate: false },
  { label: 'Script', workforce: 'media', agentId: 'scriptwriter', artifactType: 'script', isGate: false },
  { label: 'Script Review', workforce: 'media', agentId: 'script_critic', artifactType: 'script', isGate: true },
  { label: 'Video Critique', workforce: 'media', agentId: 'video_critic', artifactType: 'video_critique', isGate: false },
  { label: 'Long-form Edit', workforce: 'media', agentId: 'video_editor', artifactType: 'video_edit_plan', isGate: false },
  { label: 'Shorts Edit', workforce: 'media', agentId: 'shorts_editor', artifactType: 'shorts_edit_plan', isGate: false },
  { label: 'Channel Brand', workforce: 'media', agentId: 'channel_brand', artifactType: 'channel_branding_package', isGate: false },
  { label: 'SEO', workforce: 'media', agentId: 'seo', artifactType: 'seo_package', isGate: false },
  { label: 'Thumbnail', workforce: 'media', agentId: 'thumbnail_brief', artifactType: 'thumbnail_brief', isGate: false },
  { label: 'Visual Review', workforce: 'media', agentId: 'visual_critic', artifactType: 'thumbnail_brief', isGate: true },
  { label: 'Audio', workforce: 'media', agentId: 'audio_planner', artifactType: 'audio_plan', isGate: false },
  { label: 'Assembly', workforce: 'media', agentId: 'assembly_planner', artifactType: 'assembly_plan', isGate: false },
  { label: 'Distribution', workforce: 'media', agentId: 'distribution_manager', artifactType: 'distribution_package', isGate: false },
  { label: 'Publish', workforce: 'media', agentId: 'site_manager', artifactType: 'publish_package', isGate: false },
] as const;

export default function MediaStudioPage() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [stageIndex, setStageIndex] = useState(0);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [documents, setDocuments] = useState<ProjectDocumentItem[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [selectedImageId, setSelectedImageId] = useState('');
  const [toolOverlayText, setToolOverlayText] = useState('');
  const [toolOutputFilename, setToolOutputFilename] = useState('');
  const [latestResponse, setLatestResponse] = useState<AgentResponsePayload | null>(null);
  const [latestGate, setLatestGate] = useState<GateVerdict | null>(null);
  const [mediaToolSettings, setMediaToolSettings] = useState<ProjectMediaToolSettings | null>(null);
  const [loadingTools, setLoadingTools] = useState(false);
  const [savingTools, setSavingTools] = useState(false);
  const [runningToolId, setRunningToolId] = useState('');
  const [toolMessage, setToolMessage] = useState('');
  const [toolError, setToolError] = useState('');
  const [lastToolResult, setLastToolResult] = useState<MediaToolActionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const stage = STAGES[stageIndex];
  const enabledMediaTools = (mediaToolSettings?.tools || []).filter((tool) => tool.enabled);
  const videoDocuments = documents.filter(isVideoDocument);
  const imageDocuments = documents.filter(isImageDocument);

  const refreshArtifacts = async (nextProjectId: string, artifactType: string) => {
    const data = await getArtifacts(nextProjectId, artifactType);
    setArtifacts(data.artifacts);
  };

  const refreshDocuments = async (nextProjectId: string) => {
    if (!nextProjectId) {
      setDocuments([]);
      setSelectedVideoId('');
      setSelectedImageId('');
      return;
    }
    try {
      const data = await listProjectDocuments(nextProjectId, { limit: 250 });
      setDocuments(data.documents);
      setSelectedVideoId((current) => data.documents.some((document) => document.id === current) ? current : (data.documents.find(isVideoDocument)?.id || ''));
      setSelectedImageId((current) => data.documents.some((document) => document.id === current) ? current : (data.documents.find(isImageDocument)?.id || ''));
    } catch {
      setDocuments([]);
    }
  };

  const loadMediaTools = async (nextProjectId: string) => {
    if (!nextProjectId) {
      setMediaToolSettings(null);
      return;
    }

    setLoadingTools(true);
    try {
      const data = await getProjectMediaTools(nextProjectId);
      setMediaToolSettings(data);
      setToolError('');
    } catch (err) {
      setMediaToolSettings(null);
      setToolError(err instanceof Error ? err.message : 'Unable to load media tools.');
    } finally {
      setLoadingTools(false);
    }
  };

  useEffect(() => {
    listProjects().then((data) => {
      const mediaProjects = data.projects.filter(
        (project) => project.domains.includes('web') || project.domains.includes('youtube')
      );
      setProjects(mediaProjects);
      if (mediaProjects[0]) {
        setProjectId(mediaProjects[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    refreshArtifacts(projectId, stage.artifactType).catch(() => setArtifacts([]));
  }, [projectId, stage.artifactType]);

  useEffect(() => {
    void loadMediaTools(projectId);
  }, [projectId]);

  useEffect(() => {
    void refreshDocuments(projectId);
  }, [projectId]);

  const updateToolState = (toolId: string, updates: Partial<MediaToolSettingsItem>) => {
    setMediaToolSettings((current) => {
      if (!current) return current;
      return {
        ...current,
        tools: current.tools.map((tool) => (tool.tool_id === toolId ? { ...tool, ...updates } : tool)),
      };
    });
    setToolMessage('');
  };

  const updateToolConfigValue = (toolId: string, key: string, value: string) => {
    setMediaToolSettings((current) => {
      if (!current) return current;
      return {
        ...current,
        tools: current.tools.map((tool) =>
          tool.tool_id === toolId
            ? {
                ...tool,
                config: {
                  ...(tool.config || {}),
                  [key]: value,
                },
              }
            : tool
        ),
      };
    });
    setToolMessage('');
  };

  const saveMediaTools = async () => {
    if (!projectId || !mediaToolSettings) return;
    setSavingTools(true);
    try {
      const saved = await updateProjectMediaTools(projectId, {
        tools: mediaToolSettings.tools.map((tool) => ({
          tool_id: tool.tool_id,
          enabled: tool.enabled,
          config: tool.config || {},
        })),
      });
      setMediaToolSettings(saved);
      setToolMessage('Media tool options saved.');
      setToolError('');
    } catch (err) {
      setToolError(err instanceof Error ? err.message : 'Unable to save media tools.');
    } finally {
      setSavingTools(false);
    }
  };

  const runToolAction = async (toolId: string, action: string) => {
    if (!projectId) return;
    setRunningToolId(`${toolId}:${action}`);
    setToolError('');
    setToolMessage('');
    try {
      const activeTool = mediaToolSettings?.tools.find((tool) => tool.tool_id === toolId);
      const activeConfig = activeTool?.config || {};
      const response = await executeProjectMediaToolAction(projectId, toolId, {
        action,
        document_id: selectedVideoId || undefined,
        secondary_document_id: selectedImageId || undefined,
        arguments: {
          overlay_text: toolOverlayText.trim(),
          output_filename: toolOutputFilename.trim(),
          ...(toolId === 'youtube_comment_collector'
            ? {
                video_reference: String(activeConfig.video_reference || '').trim(),
                max_results: String(activeConfig.max_results || '').trim(),
              }
            : {}),
        },
      });
      setLastToolResult(response);
      setToolMessage(response.message);
      if (response.output_document) {
        await refreshDocuments(projectId);
      }
      await refreshArtifacts(projectId, stage.artifactType);
    } catch (err) {
      setToolError(err instanceof Error ? err.message : 'Tool action failed.');
    } finally {
      setRunningToolId('');
    }
  };

  const runStage = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      const response = await runProjectAgent(projectId, stage.workforce, stage.agentId, {
        session_id: `media-${projectId}`,
        user_input: `Run the ${stage.label.toLowerCase()} stage for the current media project.`,
        context: {
          project_id: projectId,
          current_stage: stage.label,
          existing_artifacts: artifacts,
          enabled_media_tool_ids: enabledMediaTools.map((tool) => tool.tool_id),
          enabled_media_tools: enabledMediaTools,
        },
      });
      setLatestResponse(response.response);
      setLatestGate(extractGateVerdict(response.response.content));
      setError('');
      await refreshArtifacts(projectId, stage.artifactType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stage run failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleWorkflowExecuted = async (response: ProjectChatResponse) => {
    if (response.execution?.agent_response) {
      setLatestResponse(response.execution.agent_response);
      setLatestGate(extractGateVerdict(response.execution.agent_response.content));
    } else if (response.execution) {
      setLatestResponse({
        agent_name: 'LocalWorkflowCommand',
        content: response.execution.final_output,
        confidence: 0.9,
        action_items: [],
        metadata: {
          route: response.plan.execution_mode,
          pipeline_success: response.execution.pipeline_success ?? null,
        },
      });
      setLatestGate(extractGateVerdict(response.execution.final_output));
    }
    if (projectId) {
      await refreshArtifacts(projectId, stage.artifactType);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">Media Studio</h1>
            <p className="text-sm text-slate-400">
              Drive media planning from chat. Manual stage controls remain available below as advanced overrides.
            </p>
          </div>
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
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Automation Tools</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Declare which MCP or local post-processing tools are available for this project. Media agents and local
              workflow commands will use the enabled set as part of their planning context.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
              Enabled: <span className="text-white">{enabledMediaTools.length}</span>
            </div>
            <button
              onClick={saveMediaTools}
              disabled={!projectId || !mediaToolSettings || savingTools}
              className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            >
              {savingTools ? 'Saving…' : 'Save Tool Options'}
            </button>
          </div>
        </div>

        {loadingTools && <p className="mt-4 text-sm text-slate-500">Loading media tool options…</p>}
        {toolError && <p className="mt-4 text-sm text-rose-300">{toolError}</p>}
        {toolMessage && <p className="mt-4 text-sm text-emerald-300">{toolMessage}</p>}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Primary Video Asset</span>
            <select
              value={selectedVideoId}
              onChange={(event) => setSelectedVideoId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="">Select a video asset</option>
              {videoDocuments.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.filename}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Brand Image / Watermark</span>
            <select
              value={selectedImageId}
              onChange={(event) => setSelectedImageId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="">Optional image asset</option>
              {imageDocuments.map((document) => (
                <option key={document.id} value={document.id}>
                  {document.filename}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Overlay Text</span>
            <input
              type="text"
              value={toolOverlayText}
              onChange={(event) => setToolOverlayText(event.target.value)}
              placeholder="Optional branding text or CTA"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>

          <label className="block">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500">Output Filename</span>
            <input
              type="text"
              value={toolOutputFilename}
              onChange={(event) => setToolOutputFilename(event.target.value)}
              placeholder="Optional custom output filename"
              className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-3">
          {(mediaToolSettings?.tools || []).map((tool) => (
            <div key={tool.tool_id} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{tool.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{tool.provider} · {tool.category === 'mcp' ? 'MCP tool' : 'Local tool'}</p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={tool.enabled}
                    onChange={(event) => updateToolState(tool.tool_id, { enabled: event.target.checked })}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-cyan-400 focus:ring-cyan-500"
                  />
                  Enabled
                </label>
              </div>

              <p className="mt-3 text-sm text-slate-400">{tool.description}</p>

              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Install</p>
                <code className="mt-2 block rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-cyan-300">
                  {tool.install_command}
                </code>
              </div>

              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Runtime</p>
                <p className={`mt-2 text-sm ${tool.runtime_ready ? 'text-emerald-300' : tool.runtime_available ? 'text-amber-300' : 'text-rose-300'}`}>
                  {tool.runtime_message}
                </p>
              </div>

              <div className="mt-4">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Capabilities</p>
                <div className="mt-2 space-y-2">
                  {tool.capabilities.map((capability) => (
                    <p key={capability} className="text-xs text-slate-300">
                      • {capability}
                    </p>
                  ))}
                </div>
              </div>

              {tool.enabled && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {tool.tool_id === 'ffmpeg_execute_code' && (
                    <>
                      <button
                        onClick={() => void runToolAction(tool.tool_id, 'brand_video')}
                        disabled={!selectedVideoId || runningToolId === `${tool.tool_id}:brand_video`}
                        className="rounded-full bg-cyan-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                      >
                        {runningToolId === `${tool.tool_id}:brand_video` ? 'Branding…' : 'Brand Video'}
                      </button>
                      <button
                        onClick={() => void runToolAction(tool.tool_id, 'create_shorts_cut')}
                        disabled={!selectedVideoId || runningToolId === `${tool.tool_id}:create_shorts_cut`}
                        className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:border-slate-500 disabled:opacity-60"
                      >
                        {runningToolId === `${tool.tool_id}:create_shorts_cut` ? 'Creating…' : 'Create Shorts Cut'}
                      </button>
                    </>
                  )}
                  {tool.tool_id === 'composio_youtube_mcp' && (
                    <button
                      onClick={() => void runToolAction(tool.tool_id, 'prepare_youtube_upload_package')}
                      disabled={!selectedVideoId || runningToolId === `${tool.tool_id}:prepare_youtube_upload_package`}
                      className="rounded-full bg-amber-400 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-60"
                    >
                      {runningToolId === `${tool.tool_id}:prepare_youtube_upload_package` ? 'Preparing…' : 'Prepare Upload Package'}
                    </button>
                  )}
                  {tool.tool_id === 'youtube_comment_collector' && (
                    <button
                      onClick={() => void runToolAction(tool.tool_id, 'collect_comment_feedback')}
                      disabled={!String(tool.config?.video_reference || '').trim() || runningToolId === `${tool.tool_id}:collect_comment_feedback`}
                      className="rounded-full bg-rose-400 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-rose-300 disabled:opacity-60"
                    >
                      {runningToolId === `${tool.tool_id}:collect_comment_feedback` ? 'Collecting…' : 'Collect Comment Feedback'}
                    </button>
                  )}
                  {tool.tool_id === 'notebooklm_mcp' && (
                    <button
                      onClick={() => void runToolAction(tool.tool_id, 'prepare_notebooklm_video_manifest')}
                      disabled={runningToolId === `${tool.tool_id}:prepare_notebooklm_video_manifest`}
                      className="rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-emerald-300 disabled:opacity-60"
                    >
                      {runningToolId === `${tool.tool_id}:prepare_notebooklm_video_manifest` ? 'Preparing…' : 'Prepare NotebookLM Manifest'}
                    </button>
                  )}
                </div>
              )}

              {Object.keys(tool.config || {}).length > 0 && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Project Config</p>
                  {Object.entries(tool.config || {}).map(([key, value]) => (
                    <label key={key} className="block">
                      <span className="text-xs text-slate-400">{formatToolConfigLabel(key)}</span>
                      <input
                        type="text"
                        value={String(value ?? '')}
                        onChange={(event) => updateToolConfigValue(tool.tool_id, key, event.target.value)}
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                      />
                    </label>
                  ))}
                </div>
              )}

              <div className="mt-4 space-y-2">
                {tool.notes.map((note) => (
                  <p key={note} className="text-xs text-slate-500">
                    {note}
                  </p>
                ))}
                {tool.auth_required && (
                  <p className="text-xs text-amber-300">This tool requires external authentication before it can be used reliably.</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {lastToolResult && (
          <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">
                Last Tool Action: {lastToolResult.tool_id} · {lastToolResult.action}
              </p>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${lastToolResult.success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                {lastToolResult.executed ? 'Executed' : 'Prepared'}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-400">{lastToolResult.message}</p>
            {lastToolResult.output_document && (
              <p className="mt-2 text-xs text-slate-500">
                Output document: {lastToolResult.output_document.filename}
              </p>
            )}
            {lastToolResult.command.length > 0 && (
              <code className="mt-3 block rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-cyan-300">
                {lastToolResult.command.join(' ')}
              </code>
            )}
          </div>
        )}
      </section>

      <ProjectChatPanel
        projectId={projectId}
        scope="media"
        title="Media Chat"
        description="Use chat as the primary media workflow. StudioOS can inspect current project media, attached docs, tool availability, and recent artifacts to critique footage, generate branding, and build edit or publishing plans."
        availableDocuments={documents}
        documentIds={[selectedVideoId, selectedImageId].filter(Boolean)}
        artifactIds={artifacts[0] ? [artifacts[0].id] : []}
        contextLabel={
          artifacts[0]
            ? `Current stage artifact target: ${artifacts[0].artifact_type} v${artifacts[0].version}`
            : 'No current stage artifact selected. StudioOS will fall back to recent media files, branding inputs, and artifacts.'
        }
        suggestedPrompts={[
          'Scan the current project media and draft a stronger channel branding package.',
          'Review the attached footage and propose a tighter long-form edit structure.',
          'Use the current assets to generate shorts angles, packaging, and YouTube positioning.',
        ]}
        onExecuted={(response) => {
          void handleWorkflowExecuted(response);
        }}
        onUploadComplete={() => {
          void refreshDocuments(projectId);
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr,0.9fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-lg font-semibold text-white">Advanced Manual Stage Override</h2>
          <p className="mt-2 text-sm text-slate-500">
            Current manual stage: {stage.label} · {stage.workforce}.{stage.agentId} · artifact: {stage.artifactType}
          </p>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <pre className="min-h-80 whitespace-pre-wrap text-sm text-slate-300">
              {artifacts[0]?.content || latestResponse?.content || 'No artifact available for this stage yet.'}
            </pre>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Manual Stage Controls</h2>
            <p className="mt-2 text-sm text-slate-500">
              Use these only when you want to override the chat-driven path and force a specific stage directly.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {STAGES.map((item, index) => (
                <button
                  key={item.label}
                  onClick={() => setStageIndex(index)}
                  className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
                    index === stageIndex
                      ? 'border-amber-400 bg-amber-400/15 text-amber-200'
                      : 'border-slate-800 bg-slate-950/70 text-slate-300'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              onClick={runStage}
              disabled={!projectId || busy}
              className="mt-4 rounded-full bg-amber-400 px-5 py-2.5 text-sm font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-60"
            >
              {busy ? 'Running…' : 'Run Stage'}
            </button>

            {error && <p className="mt-4 text-sm text-rose-300">{error}</p>}

            {latestGate && (
              <div
                className={`mt-4 rounded-xl border p-4 text-sm ${
                  latestGate.passed
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                }`}
              >
                <p>{latestGate.passed ? 'Gate passed' : 'Gate failed'}</p>
                <p className="mt-1">{latestGate.reason}</p>
                {latestGate.revisions.length > 0 && (
                  <ul className="mt-3 space-y-1 text-slate-200">
                    {latestGate.revisions.map((revision, index) => (
                      <li key={`${revision}-${index}`}>• {revision}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="text-lg font-semibold text-white">Artifact History</h2>
            <div className="mt-4 space-y-3">
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Version {artifact.version}</span>
                    <span className="text-xs text-slate-500">{new Date(artifact.created_at).toLocaleString()}</span>
                  </div>
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-slate-400">{artifact.content || 'No content.'}</p>
                </div>
              ))}
              {artifacts.length === 0 && <p className="text-sm text-slate-500">No prior versions for this stage.</p>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function extractGateVerdict(content: string): GateVerdict | null {
  const fencedMatch = content.match(/```json\s*([\s\S]*?)```/i);
  const candidates = [content, fencedMatch?.[1] || ''];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (typeof parsed?.passed === 'boolean') {
        return {
          passed: parsed.passed,
          reason: String(parsed.reason || ''),
          revisions: Array.isArray(parsed.revisions) ? parsed.revisions.map(String) : [],
          blocking: typeof parsed.blocking === 'boolean' ? parsed.blocking : true,
        };
      }
    } catch {}
  }
  return null;
}

function formatToolConfigLabel(key: string): string {
  return key
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

function isVideoDocument(document: ProjectDocumentItem): boolean {
  const contentType = (document.content_type || '').toLowerCase();
  const filename = document.filename.toLowerCase();
  return contentType.startsWith('video/') || ['.mp4', '.mov', '.webm', '.m4v', '.avi'].some((suffix) => filename.endsWith(suffix));
}

function isImageDocument(document: ProjectDocumentItem): boolean {
  const contentType = (document.content_type || '').toLowerCase();
  const filename = document.filename.toLowerCase();
  return contentType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].some((suffix) => filename.endsWith(suffix));
}
