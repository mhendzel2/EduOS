import type {
  AgentResponsePayload,
  Artifact,
  BrandAutocompleteResponse,
  BrandBible,
  HealthResponse,
  MediaToolActionResponse,
  MemoryAutocompleteResult,
  ModelRoutingConfig,
  Notification,
  OllamaBootstrapStatus,
  PipelineBuilderStep,
  PipelineKind,
  PipelineRunResponse,
  ProjectMediaToolSettings,
  ProjectMemory,
  ProjectChatMessage,
  ProjectChatResponse,
  ProjectDocumentItem,
  ProjectImportResponse,
  ProjectAgentRunResponse,
  PromptFeedback,
  PromptFeedbackListResponse,
  PromptOptimizationResult,
  RunRecord,
  SearchResultItem,
  StoryBible,
  StudioProject,
  TelegramControlStatus,
  PromptTemplate,
  UploadDocumentResponse,
  WorkflowCommandResponse,
  WorkspaceMemory,
  WorkforceStatus,
} from './types';

export type { ModelRoutingConfig } from './types';

const API_TARGET_STORAGE_KEY = 'studioos.apiTarget';
const LOCAL_API_FALLBACK = 'http://127.0.0.1:8015';

export function normalizeApiHost(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

export function getServerSafeDefaultApiHost(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return normalizeApiHost(configured);
  }
  return LOCAL_API_FALLBACK;
}

export function getDefaultApiHost(): string {
  const fallback = getServerSafeDefaultApiHost();
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8015`;
  }
  return fallback;
}

export function getApiHostOverride(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(API_TARGET_STORAGE_KEY);
  if (!stored) {
    return null;
  }
  const normalized = normalizeApiHost(stored);
  return normalized || null;
}

export function setApiHostOverride(value: string | null): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const normalized = normalizeApiHost(value || '');
  if (normalized) {
    window.localStorage.setItem(API_TARGET_STORAGE_KEY, normalized);
  } else {
    window.localStorage.removeItem(API_TARGET_STORAGE_KEY);
  }

  return normalized || null;
}

export function getApiHost(): string {
  return getApiHostOverride() || getDefaultApiHost();
}

export function getApiBaseUrl(): string {
  return `${getApiHost()}/api/v1`;
}

function formatApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === 'string') {
    return detail.trim() || null;
  }

  if (Array.isArray(detail)) {
    const formatted = detail
      .map((item) => formatApiErrorDetail(item) || (typeof item === 'object' ? JSON.stringify(item) : String(item)))
      .filter((item) => item.trim().length > 0);
    return formatted.length > 0 ? formatted.join('\n') : null;
  }

  if (detail && typeof detail === 'object') {
    const record = detail as Record<string, unknown>;
    if (typeof record.msg === 'string' && record.msg.trim()) {
      return record.msg.trim();
    }
    return JSON.stringify(record);
  }

  if (detail == null) {
    return null;
  }

  return String(detail);
}

export async function readApiErrorMessage(response: Response): Promise<string> {
  const fallback = `API error: ${response.status} ${response.statusText}`.trim();

  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      const detail = formatApiErrorDetail((payload as { detail?: unknown }).detail);
      if (detail) {
        return detail;
      }
      const message = formatApiErrorDetail((payload as { message?: unknown }).message);
      return message || fallback;
    }

    const text = await response.text();
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }

  return response.json() as Promise<T>;
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${getApiHost()}${normalized}`;
}

export function getDocumentContentUrl(documentId: string): string {
  return resolveApiUrl(`/api/v1/documents/${documentId}/content`);
}

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchAPI<HealthResponse>('/health');
}

export async function getTelegramControlStatus(): Promise<TelegramControlStatus> {
  return fetchAPI<TelegramControlStatus>('/telegram/status');
}

export async function listProjects(): Promise<{ projects: StudioProject[] }> {
  return fetchAPI<{ projects: StudioProject[] }>('/projects');
}

export async function getProject(projectId: string): Promise<StudioProject> {
  return fetchAPI<StudioProject>(`/projects/${projectId}`);
}

export async function createProject(data: {
  name: string;
  description?: string;
  domains: string[];
}): Promise<StudioProject> {
  return fetchAPI<StudioProject>('/projects', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listProjectRuns(projectId: string): Promise<{ runs: RunRecord[] }> {
  return fetchAPI<{ runs: RunRecord[] }>(`/projects/${projectId}/runs`);
}

export async function getRun(runId: string): Promise<RunRecord> {
  return fetchAPI<RunRecord>(`/runs/${runId}`);
}

export async function getProjectDomains(projectId: string): Promise<WorkforceStatus> {
  return fetchAPI<WorkforceStatus>(`/projects/${projectId}/domains`);
}

export async function getStoryBible(projectId: string): Promise<{ story_bible: StoryBible }> {
  return fetchAPI<{ story_bible: StoryBible }>(`/projects/${projectId}/story-bible`);
}

export async function updateStoryBible(projectId: string, bible: StoryBible) {
  return fetchAPI(`/projects/${projectId}/story-bible`, {
    method: 'PUT',
    body: JSON.stringify({ value: bible }),
  });
}

export async function getBrandBible(projectId: string): Promise<{ brand_bible: BrandBible }> {
  return fetchAPI<{ brand_bible: BrandBible }>(`/projects/${projectId}/brand-bible`);
}

export async function updateBrandBible(projectId: string, bible: BrandBible) {
  return fetchAPI(`/projects/${projectId}/brand-bible`, {
    method: 'PUT',
    body: JSON.stringify({ value: bible }),
  });
}

export async function listPromptTemplates(params?: {
  category?: string;
  projectId?: string;
}): Promise<{ prompts: PromptTemplate[] }> {
  const searchParams = new URLSearchParams();
  if (params?.category) {
    searchParams.set('category', params.category);
  }
  if (params?.projectId) {
    searchParams.set('project_id', params.projectId);
  }
  const query = searchParams.toString();
  return fetchAPI<{ prompts: PromptTemplate[] }>(`/prompt-library${query ? `?${query}` : ''}`);
}

export async function createPromptTemplate(data: {
  project_id?: string | null;
  name: string;
  category: string;
  target_kind: string;
  description: string;
  system_prompt: string;
  user_prompt_template: string;
  tags: string[];
  metadata: Record<string, unknown>;
}): Promise<PromptTemplate> {
  return fetchAPI<PromptTemplate>('/prompt-library', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePromptTemplate(
  promptId: string,
  data: {
    project_id?: string | null;
    name?: string;
    category?: string;
    target_kind?: string;
    description?: string;
    system_prompt?: string;
    user_prompt_template?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }
): Promise<PromptTemplate> {
  return fetchAPI<PromptTemplate>(`/prompt-library/${promptId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function listPromptFeedback(promptId: string): Promise<PromptFeedbackListResponse> {
  return fetchAPI<PromptFeedbackListResponse>(`/prompt-library/${promptId}/feedback`);
}

export async function createPromptFeedback(
  promptId: string,
  data: {
    project_id?: string | null;
    run_id?: string | null;
    feedback_source?: string;
    score: number;
    would_reuse?: boolean | null;
    use_case?: string;
    strengths?: string[];
    failure_modes?: string[];
    notes?: string;
    task_input?: string;
    output_excerpt?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<PromptFeedback> {
  return fetchAPI<PromptFeedback>(`/prompt-library/${promptId}/feedback`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function optimizePromptTemplate(
  promptId: string,
  data: {
    project_id?: string | null;
    goal?: string;
    create_variant?: boolean;
    variant_name?: string;
  }
): Promise<PromptOptimizationResult> {
  return fetchAPI<PromptOptimizationResult>(`/prompt-library/${promptId}/optimize`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function autocompleteBrandBible(
  projectId: string,
  data: {
    field:
      | 'brand_name'
      | 'voice_tone'
      | 'style_guide'
      | 'audience_personas'
      | 'off_brand_examples'
      | 'published_content_index'
      | 'all';
    prompt_template_id?: string | null;
    guidance?: string;
    brand_bible: Partial<BrandBible>;
  }
): Promise<BrandAutocompleteResponse> {
  return fetchAPI<BrandAutocompleteResponse>(`/projects/${projectId}/brand-bible/autocomplete`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getWorkspaceMemory(): Promise<WorkspaceMemory> {
  return fetchAPI<WorkspaceMemory>('/memory/global');
}

export async function updateWorkspaceMemory(data: {
  summary: string;
  pinned_facts: string[];
}): Promise<WorkspaceMemory> {
  return fetchAPI<WorkspaceMemory>('/memory/global', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function autocompleteWorkspaceMemory(data: {
  prompt_template_id?: string | null;
  guidance?: string;
}): Promise<MemoryAutocompleteResult> {
  return fetchAPI<MemoryAutocompleteResult>('/memory/global/autocomplete', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getProjectMemory(projectId: string): Promise<ProjectMemory> {
  return fetchAPI<ProjectMemory>(`/projects/${projectId}/memory`);
}

export async function updateProjectMemory(
  projectId: string,
  data: { summary: string; pinned_facts: string[] }
): Promise<ProjectMemory> {
  return fetchAPI<ProjectMemory>(`/projects/${projectId}/memory`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function autocompleteProjectMemory(
  projectId: string,
  data: { prompt_template_id?: string | null; guidance?: string }
): Promise<MemoryAutocompleteResult> {
  return fetchAPI<MemoryAutocompleteResult>(`/projects/${projectId}/memory/autocomplete`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getModelRoutingConfig(): Promise<ModelRoutingConfig> {
  return fetchAPI<ModelRoutingConfig>('/model-routing/config');
}

export async function updateModelRoutingConfig(data: {
  agent_overrides?: Record<string, string>;
  tier_overrides?: Record<string, string>;
  strategy?: string;
}): Promise<ModelRoutingConfig> {
  return fetchAPI<ModelRoutingConfig>('/model-routing/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getOllamaBootstrapStatus(): Promise<OllamaBootstrapStatus> {
  return fetchAPI<OllamaBootstrapStatus>('/runtime/ollama');
}

export async function startOllamaBootstrap(model?: string | null): Promise<OllamaBootstrapStatus> {
  return fetchAPI<OllamaBootstrapStatus>('/runtime/ollama/start', {
    method: 'POST',
    body: JSON.stringify({ model: model || null }),
  });
}

export async function getArtifacts(projectId: string, artifactType?: string): Promise<{ artifacts: Artifact[] }> {
  const params = artifactType ? `?artifact_type=${encodeURIComponent(artifactType)}` : '';
  return fetchAPI<{ artifacts: Artifact[] }>(`/projects/${projectId}/artifacts${params}`);
}

export async function uploadDocument(
  file: File,
  projectId: string,
  options: { sourcePath?: string } = {}
): Promise<UploadDocumentResponse> {
  const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}/documents`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Studio-Filename': encodeURIComponent(file.name),
      ...(options.sourcePath ? { 'X-Studio-Source-Path': encodeURIComponent(options.sourcePath) } : {}),
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }

  const document = await response.json() as ProjectDocumentItem;
  return { ...document, document_id: document.id };
}

export async function listProjectDocuments(
  projectId: string,
  options: { limit?: number } = {}
): Promise<{ documents: ProjectDocumentItem[] }> {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set('limit', String(options.limit));
  }
  const query = params.toString();
  return fetchAPI<{ documents: ProjectDocumentItem[] }>(
    `/projects/${projectId}/documents${query ? `?${query}` : ''}`
  );
}

export async function importProjectDocumentsFromPath(
  projectId: string,
  payload: { source_path: string; mode?: 'copy' | 'reference'; recursive?: boolean }
): Promise<ProjectImportResponse> {
  return fetchAPI<ProjectImportResponse>(`/projects/${projectId}/documents/import-path`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getProjectMediaTools(projectId: string): Promise<ProjectMediaToolSettings> {
  return fetchAPI<ProjectMediaToolSettings>(`/projects/${projectId}/media-tools`);
}

export async function updateProjectMediaTools(
  projectId: string,
  payload: {
    tools: Array<{
      tool_id: string;
      enabled: boolean;
      config: Record<string, unknown>;
    }>;
  }
): Promise<ProjectMediaToolSettings> {
  return fetchAPI<ProjectMediaToolSettings>(`/projects/${projectId}/media-tools`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function executeProjectMediaToolAction(
  projectId: string,
  toolId: string,
  payload: {
    action: string;
    document_id?: string | null;
    secondary_document_id?: string | null;
    arguments?: Record<string, unknown>;
  }
): Promise<MediaToolActionResponse> {
  return fetchAPI<MediaToolActionResponse>(`/projects/${projectId}/media-tools/${toolId}/execute`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteProjectDocument(documentId: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/documents/${documentId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await readApiErrorMessage(response));
  }
}

export async function searchDocuments(
  query: string,
  projectId?: string,
  limit = 5
): Promise<{ query: string; results: SearchResultItem[] }> {
  if (!projectId) {
    return { query, results: [] };
  }

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  return fetchAPI<{ query: string; results: SearchResultItem[] }>(
    `/projects/${projectId}/documents/search?${params.toString()}`
  );
}

export async function callWorkforceAgent(
  workforce: string,
  agentId: string,
  payload: { session_id: string; user_input: string; context?: object }
): Promise<AgentResponsePayload> {
  return fetchAPI<AgentResponsePayload>(`/agent/${workforce}/${agentId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runProjectPipeline(
  projectId: string,
  payload: { task: string; pipeline_kind?: PipelineKind; context?: Record<string, unknown> }
): Promise<PipelineRunResponse> {
  return fetchAPI<PipelineRunResponse>(`/projects/${projectId}/pipeline`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runProjectCustomPipeline(
  projectId: string,
  payload: { task: string; steps: PipelineBuilderStep[]; context?: Record<string, unknown> }
): Promise<PipelineRunResponse> {
  return fetchAPI<PipelineRunResponse>(`/projects/${projectId}/pipeline-builder`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runProjectAgent(
  projectId: string,
  workforce: string,
  agentId: string,
  payload: { session_id: string; user_input: string; context?: object }
): Promise<ProjectAgentRunResponse> {
  return fetchAPI<ProjectAgentRunResponse>(`/projects/${projectId}/agent/${workforce}/${agentId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runProjectWorkflowCommand(
  projectId: string,
  payload: {
    command: string;
    scope?: 'workspace' | 'media' | 'general';
    document_ids?: string[];
    artifact_ids?: string[];
    execute?: boolean;
  }
): Promise<WorkflowCommandResponse> {
  return fetchAPI<WorkflowCommandResponse>(`/projects/${projectId}/workflow-command`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runProjectChat(
  projectId: string,
  payload: {
    message: string;
    scope?: 'workspace' | 'media' | 'general';
    conversation?: ProjectChatMessage[];
    document_ids?: string[];
    artifact_ids?: string[];
    include_project_media?: boolean;
    execute?: boolean;
    model_target?: 'local' | 'openrouter';
    external_model?: string;
  }
): Promise<ProjectChatResponse> {
  return fetchAPI<ProjectChatResponse>(`/projects/${projectId}/chat`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function getNotificationUnreadCount(): Promise<{ count: number }> {
  return { count: 0 };
}

export async function listNotifications(): Promise<Notification[]> {
  return [];
}

export async function markNotificationRead(_: string): Promise<void> {
  return;
}

export async function markAllNotificationsRead(): Promise<void> {
  return;
}
