import type {
  BioPipelineAssistedAdvisorResponse,
  BioPipelineAssistedRunResponse,
  BioPipelineDatasetRecommendation,
  BioPipelineStep,
  ConsensusResponse,
  DocumentUploadResponse,
  FilesystemBrowseResponse,
  LocalChatImageAttachment,
  LocalChatMessage,
  LocalChatResponse,
  ModelCatalogEntry,
  ModelProviderStatus,
  OpenRouterMultimodalImage,
  OpenRouterMultimodalResponse,
  OllamaBootstrapStatus,
  ProjectDocumentListResponse,
  ProviderApiKeyStatus,
  PublicDataRecord,
  PipelineResponse,
  ProposalRevisionAuditResponse,
  ProposalRevisionBatchResponse,
  ProposalRevisionFinalResponse,
  ProposalRevisionFormat,
  ProposalRevisionFormatResponse,
  RunDetailResponse,
  RunStreamEvent,
  SearchResultItem,
  Script,
  SystemSettingsResponse,
  TaskResponse,
} from './types';

function resolveApiHost(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:8005`;
  }
  return 'http://127.0.0.1:8005';
}

const API_HOST = resolveApiHost();
const API_HOST_CANDIDATES = resolveApiHostCandidates(API_HOST);
const API_BASE_URL = `${API_HOST}/api/v1`;

function resolveApiHostCandidates(primaryHost: string): string[] {
  const candidates = new Set<string>();
  const trimmedPrimary = primaryHost.replace(/\/+$/, '');
  if (trimmedPrimary) {
    candidates.add(trimmedPrimary);
  }

  try {
    const url = new URL(trimmedPrimary);
    const hostname = url.hostname.toLowerCase();
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isLocalHost) {
      for (const port of ['8005', '8000']) {
        const candidate = `${url.protocol}//${hostname}:${port}`;
        candidates.add(candidate);
      }
    }
  } catch {
    // Ignore invalid URLs and stick with the primary host.
  }

  return Array.from(candidates);
}

// ── Re-exported types (imported from '@/lib/api' by several components) ──

export interface Notification {
  id: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  uid: string;
  title: string;
  description: string;
  location: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  source: string;
  calendar_name: string;
  color: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface ScheduledTask {
  id: string;
  name: string;
  task_type: string;
  schedule: string;
  enabled: boolean;
  project_id?: string | null;
  config: Record<string, unknown>;
  last_run_at?: string | null;
  last_status: string;
  last_result_summary: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Email {
  id: string;
  message_id: string;
  subject: string;
  sender: string;
  recipients: unknown;
  date?: string | null;
  body_text?: string | null;
  body_html?: string | null;
  folder: string;
  is_read: boolean;
  is_flagged: boolean;
  priority?: string | null;
  ai_summary?: string | null;
  ai_category?: string | null;
  needs_response?: boolean | null;
  suggested_action?: string | null;
  triaged_at?: string | null;
  created_at?: string | null;
}

export interface DeepResearchResult {
  success: boolean;
  report: string;
  model_reports?: DeepResearchModelReport[];
  synthesized_report?: string | null;
  synthesis_model?: string | null;
  metadata: Record<string, unknown> & { saved_document_id?: string | null };
  error?: string | null;
}

export interface DeepResearchModelReport {
  model: string;
  draft?: string;
  review_notes?: string;
  report: string;
}

export interface DeepResearchPrompt {
  id: string;
  project_id?: string | null;
  source_prompt_id?: string | null;
  title: string;
  description: string;
  prompt_kind: string;
  source_type: string;
  prompt_text: string;
  tags: string[];
  biological_context: Record<string, unknown>;
  usage_count: number;
  effectiveness_notes: string;
  quality_rating?: number | null;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeepResearchPromptCompileResponse {
  prompt: string;
  compiled_path?: string | null;
  saved_prompt?: DeepResearchPrompt | null;
  biological_context: Record<string, unknown>;
}

export interface SavedPrompt {
  id: string;
  project_id?: string | null;
  source_prompt_id?: string | null;
  title: string;
  description: string;
  prompt_kind: string;
  source_type: string;
  prompt_text: string;
  tags: string[];
  prompt_context: Record<string, unknown>;
  usage_count: number;
  effectiveness_notes: string;
  quality_rating?: number | null;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
  library_scope: string;
  is_editable: boolean;
}

export interface RepoPromptLibraryEntry {
  id: string;
  title: string;
  description: string;
  prompt_kind: string;
  prompt_text: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface DeepResearchOffloadIngestResponse {
  source_prompt_id?: string | null;
  parsed_claim_count: number;
  valid_claim_count: number;
  rejected_claim_count: number;
  sanitized_text: string;
  valid_claims: Record<string, unknown>[];
  rejected_claims: Record<string, unknown>[];
  validation_results: Record<string, unknown>;
}

export interface PubMedSearchResult {
  articles: Record<string, unknown>[];
  total: number;
  query: string;
  provenance_id?: string;
}

export interface AcademicResult {
  results: Record<string, unknown>[];
  total: number;
  query: string;
  provenance_id?: string;
}

export interface LiteratureSearchHistoryEntry {
  id: string;
  project_id?: string | null;
  run_id?: string | null;
  source_type: string;
  triggered_by: string;
  query: string;
  request_params: Record<string, unknown>;
  result_count: number;
  created_at?: string | null;
}

export interface LiteratureSearchHistoryDetail extends LiteratureSearchHistoryEntry {
  results: Record<string, unknown>[];
}

export interface LiteratureSearchHistoryResponse {
  searches: LiteratureSearchHistoryEntry[];
  total: number;
}

export interface PromptFeedbackQuestionsRequest {
  telemetry_id?: string;
  run_id?: string;
  task?: string;
  agent_name?: string;
  current_prompt?: string;
  output_text?: string;
}

export interface PromptFeedbackQuestionsResponse {
  telemetry_id?: string;
  run_id?: string;
  task_type: string;
  agent_name: string;
  used_local_model: boolean;
  questions: string[];
}

export interface PromptFeedbackSubmitRequest {
  quality_rating: number;
  comments?: string;
  prompt_effectiveness?: number;
  factual_confidence?: number;
  completeness?: number;
  structure_fit?: number;
  would_reuse_prompt?: boolean;
  guided_answers?: Record<string, string>;
}

export interface PromptFeedbackSubmitResponse {
  id: string;
  task_type: string;
  agent_name: string;
  model_used: string;
  success: boolean;
  evaluation_score?: number | null;
  evaluation_label: string;
  feedback_notes: string;
  created_at?: string | null;
}

export interface SearchResponse {
  results: SearchResultItem[];
  total: number;
  query: string;
}

export interface RAGAnswer {
  answer: string;
  sources: unknown[];
  query: string;
}

export interface ModelRoutingConfig {
  agent_overrides: Record<string, string>;
  tier_overrides: Record<string, string>;
  strategy: string;
  supported_models: string[];
  tiers: string[];
  providers: ModelProviderStatus[];
  model_costs: Record<string, { input: number; output: number }>;
  [key: string]: unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────

async function readApiErrorMessage(res: Response): Promise<string> {
  const fallback = `API error: ${res.status} ${res.statusText}`.trim();

  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await res.json();
      if (typeof payload?.detail === 'string' && payload.detail.trim()) {
        return payload.detail.trim();
      }
      if (typeof payload?.message === 'string' && payload.message.trim()) {
        return payload.message.trim();
      }
      return fallback;
    }

    const text = await res.text();
    return text.trim() || fallback;
  } catch {
    return fallback;
  }
}

async function fetchAPI(endpoint: string, options: RequestInit = {}) {
  let lastError: unknown;

  for (const host of API_HOST_CANDIDATES) {
    try {
      const res = await fetch(`${host}/api/v1${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res));
      }
      return res.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to fetch from all configured API hosts');
}

async function fetchRaw(endpoint: string, options: RequestInit = {}): Promise<Response> {
  let lastError: unknown;

  for (const host of API_HOST_CANDIDATES) {
    try {
      const res = await fetch(`${host}/api/v1${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });
      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res));
      }
      return res;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to fetch from all configured API hosts');
}

export function resolveApiUrl(pathOrUrl: string): string {
  if (!pathOrUrl) {
    return '';
  }
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  const host = API_HOST.replace(/\/+$/, '');
  if (pathOrUrl.startsWith('/')) {
    return `${host}${pathOrUrl}`;
  }
  return `${API_BASE_URL}/${pathOrUrl.replace(/^\/+/, '')}`;
}

export function getDocumentContentUrl(documentId: string): string {
  return resolveApiUrl(`/api/v1/documents/file/${encodeURIComponent(documentId)}`);
}

// ── Health / Telemetry ──────────────────────────────────────────────

export async function fetchHealth() {
  return fetchAPI('/health');
}

// ── Activity Monitor ────────────────────────────────────────────────

export interface ActivitySnapshot {
  active_runs: ActivityRun[];
  stalled_runs: string[];
  loop_runs: string[];
  uptime_s: number;
  heartbeat_seq: number;
}

export interface ActivityRun {
  run_id: string;
  agent: string;
  task_preview: string;
  status: string;
  elapsed_s: number;
  idle_s: number;
  event_count: number;
}

export async function fetchActivitySnapshot(): Promise<ActivitySnapshot> {
  return fetchAPI('/activity/snapshot');
}

export async function cancelTrackedRun(runId: string): Promise<{ cancelled: boolean; run_id: string }> {
  return fetchAPI(`/activity/cancel/${encodeURIComponent(runId)}`, {
    method: 'POST',
  });
}

export interface ActivityDiagnosis {
  run_id: string;
  diagnosis: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  action: 'wait' | 'restart' | 'cancel';
  reason: string;
}

export async function fetchActivityDiagnoses(): Promise<{ diagnoses: ActivityDiagnosis[] }> {
  return fetchAPI('/activity/diagnoses');
}

export function subscribeActivityStream(
  onMessage: (event: { type: string } & Record<string, unknown>) => void,
  onError?: (err: Event) => void,
): EventSource {
  const es = new EventSource(`${API_BASE_URL}/activity/stream`);
  const handler = (e: MessageEvent) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch { /* ignore parse errors */ }
  };
  es.addEventListener('snapshot', handler);
  es.addEventListener('heartbeat', handler);
  es.addEventListener('run.started', handler);
  es.addEventListener('run.completed', handler);
  es.addEventListener('run.cancelled', handler);
  es.addEventListener('diagnosis', handler);
  es.addEventListener('auto_cancelled', handler);
  es.onerror = onError ?? null;
  return es;
}

export async function getSystemSettings(): Promise<SystemSettingsResponse> {
  return fetchAPI('/config/system-settings');
}

export async function updateSystemSettings(data: {
  security_mode?: string;
  storage_root?: string;
  external_docs_dir?: string;
  database_path?: string;
  default_project_name?: string;
  default_project_description?: string;
  auto_ingest_on_startup?: boolean;
  scheduler_enabled?: boolean;
  memory_enabled?: boolean;
  ollama_base_url?: string;
  browser_base_url?: string;
  library_proxy_prefix?: string;
  library_cookie_jar_path?: string;
  download_proxies?: string[];
  use_vpn?: boolean;
}): Promise<SystemSettingsResponse> {
  return fetchAPI('/config/system-settings', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function browseLocalFilesystem(path = ''): Promise<FilesystemBrowseResponse> {
  return fetchAPI(`/config/filesystem/browse?path=${encodeURIComponent(path)}`);
}

export async function getTelemetrySummary(days = 30) {
  return fetchAPI(`/telemetry/summary?days=${days}`);
}

// ── Notifications ───────────────────────────────────────────────────

export async function getNotificationUnreadCount(): Promise<{ count: number }> {
  try {
    return await fetchAPI('/notifications/unread-count');
  } catch {
    return { count: 0 };
  }
}

export async function listNotifications(): Promise<Notification[]> {
  try {
    return await fetchAPI('/notifications');
  } catch {
    return [];
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  await fetchAPI(`/notifications/${id}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<void> {
  await fetchAPI('/notifications/read-all', { method: 'POST' });
}

// ── Projects ────────────────────────────────────────────────────────

export async function listProjects() {
  return fetchAPI('/projects');
}

export async function createProject(data: { name: string; description?: string }) {
  return fetchAPI('/projects', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function linkProjectNotebook(
  projectId: string,
  data: { experiment_id?: string; title?: string; summary?: string; create_remote?: boolean; metadata?: Record<string, unknown> },
) {
  return fetchAPI(`/projects/${encodeURIComponent(projectId)}/notebook`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function syncProjectNotebook(projectId: string) {
  return fetchAPI(`/projects/${encodeURIComponent(projectId)}/notebook/sync`, {
    method: 'POST',
  });
}

// ── Tasks ───────────────────────────────────────────────────────────

export async function executeTask(data: { task: string; agent?: string; context?: Record<string, unknown> }): Promise<TaskResponse>;
export async function executeTask(task: string, context?: Record<string, unknown>, agent?: string): Promise<TaskResponse>;
export async function executeTask(
  dataOrTask: { task: string; agent?: string; context?: Record<string, unknown> } | string,
  context?: Record<string, unknown>,
  agent?: string,
) {
  const data = typeof dataOrTask === 'string'
    ? { task: dataOrTask, context: context || {}, agent }
    : dataOrTask;
  return fetchAPI('/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function sendLocalChat(data: {
  message: string;
  history?: LocalChatMessage[];
  project_id?: string;
  model?: string;
  document_ids?: string[];
  image_attachments?: LocalChatImageAttachment[];
  context?: Record<string, unknown>;
  temperature?: number;
}): Promise<LocalChatResponse> {
  const res = await fetch(`${API_BASE_URL}/chat/local`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    let detail = `API error: ${res.statusText}`;
    try {
      const payload = await res.json();
      if (typeof payload?.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail;
      }
    } catch {
      // Fall back to the HTTP status text when the error body is not JSON.
    }
    throw new Error(detail);
  }

  return res.json() as Promise<LocalChatResponse>;
}

export async function sendOpenRouterMultimodalChat(data: {
  message: string;
  history?: LocalChatMessage[];
  image?: OpenRouterMultimodalImage;
  project_id?: string;
  model?: string;
  temperature?: number;
  reasoning_effort?: 'low' | 'medium' | 'high';
  context?: Record<string, unknown>;
}): Promise<OpenRouterMultimodalResponse> {
  const res = await fetch(`${API_BASE_URL}/chat/openrouter-multimodal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    let detail = `API error: ${res.statusText}`;
    try {
      const payload = await res.json();
      if (typeof payload?.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail;
      }
    } catch {
      // Fall back to the HTTP status text when the error body is not JSON.
    }
    throw new Error(detail);
  }

  return res.json() as Promise<OpenRouterMultimodalResponse>;
}

export async function getPromptFeedbackQuestions(
  data: PromptFeedbackQuestionsRequest,
): Promise<PromptFeedbackQuestionsResponse> {
  return fetchAPI('/prompt-learning/feedback/questions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function submitPromptFeedback(
  telemetryId: string,
  data: PromptFeedbackSubmitRequest,
): Promise<PromptFeedbackSubmitResponse> {
  return fetchAPI(`/prompt-learning/feedback/${encodeURIComponent(telemetryId)}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function invokeCrossOSHandoff(data: {
  session_id: string;
  source_os: string;
  target_os: string;
}): Promise<{ status: string; message: string }> {
  return fetchAPI('/handoff', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

async function collectStreamEvents(
  path: string,
  payload: Record<string, unknown>,
  onEvent?: (event: RunStreamEvent) => void,
): Promise<RunStreamEvent[]> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`Streaming request failed: ${res.statusText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response body was empty');
  }

  const decoder = new TextDecoder();
  const events: RunStreamEvent[] = [];
  let buffer = '';
  let streamError: Error | null = null;

  const flushEventBlock = (block: string) => {
    const lines = block.split('\n');
    let eventType = 'message';
    const dataLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    const parsed = JSON.parse(dataLines.join('\n')) as Partial<RunStreamEvent> & { payload?: Record<string, unknown> };
    const event: RunStreamEvent = {
      sequence: typeof parsed.sequence === 'number' ? parsed.sequence : Date.now(),
      event_type: parsed.event_type || eventType,
      payload: parsed.payload || {},
      created_at: parsed.created_at || new Date().toISOString(),
    };

    events.push(event);
    onEvent?.(event);

    if (event.event_type === 'error') {
      const detail = typeof event.payload?.detail === 'string'
        ? event.payload.detail
        : 'Streaming request failed';
      streamError = new Error(detail);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf('\n\n');

    while (separatorIndex !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      flushEventBlock(block);
      if (streamError) {
        await reader.cancel();
        throw streamError;
      }
      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  if (buffer.trim()) {
    flushEventBlock(buffer);
  }

  if (streamError) {
    throw streamError;
  }

  return events;
}

export async function streamTask(data: { task: string; agent?: string; context?: Record<string, unknown> }, onEvent?: (event: RunStreamEvent) => void): Promise<TaskResponse>;
export async function streamTask(task: string, context?: Record<string, unknown>, agent?: string, onEvent?: (event: RunStreamEvent) => void): Promise<TaskResponse>;
export async function streamTask(
  dataOrTask: { task: string; agent?: string; context?: Record<string, unknown> } | string,
  contextOrOnEvent?: Record<string, unknown> | ((event: RunStreamEvent) => void),
  agent?: string,
  onEvent?: (event: RunStreamEvent) => void,
): Promise<TaskResponse> {
  const payload = typeof dataOrTask === 'string'
    ? {
        task: dataOrTask,
        context: typeof contextOrOnEvent === 'function' ? {} : (contextOrOnEvent || {}),
        agent,
      }
    : dataOrTask;
  const callback = typeof contextOrOnEvent === 'function' ? contextOrOnEvent : onEvent;

  const events = await collectStreamEvents('/tasks/stream', payload as Record<string, unknown>, callback);
  const finalEvent = [...events].reverse().find((event) => event.event_type === 'task.result');

  if (!finalEvent) {
    throw new Error('Task stream ended without a final result');
  }

  return finalEvent.payload as unknown as TaskResponse;
}

// ── Consensus ───────────────────────────────────────────────────────

export async function getConsensus(data: { prompt: string; models?: string[]; context?: Record<string, unknown> }): Promise<ConsensusResponse>;
export async function getConsensus(prompt: string, models?: string[], context?: Record<string, unknown>): Promise<ConsensusResponse>;
export async function getConsensus(
  dataOrPrompt: { prompt: string; models?: string[]; context?: Record<string, unknown> } | string,
  models?: string[],
  context?: Record<string, unknown>,
) {
  const data = typeof dataOrPrompt === 'string'
    ? { prompt: dataOrPrompt, models, context }
    : dataOrPrompt;
  return fetchAPI('/consensus', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Pipeline ────────────────────────────────────────────────────────

export async function streamPipeline(
  taskOrData: string | { task: string; context?: Record<string, unknown>; steps?: string[] },
  context?: Record<string, unknown>,
  steps?: string[],
  onEvent?: (event: RunStreamEvent) => void,
): Promise<PipelineResponse> {
  const payload = typeof taskOrData === 'string'
    ? { task: taskOrData, context: context || {}, steps: steps || [] }
    : taskOrData;

  const res = await fetch(`${API_BASE_URL}/pipeline/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Pipeline stream failed: ${res.statusText}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Pipeline stream did not return a readable body');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let finalResponse: PipelineResponse | null = null;

  const flushEventBlock = (block: string) => {
    const lines = block.split('\n');
    let eventType = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    if (dataLines.length === 0) {
      return;
    }

    const rawData = dataLines.join('\n');
    const parsed = JSON.parse(rawData);
    const event: RunStreamEvent = {
      sequence: typeof parsed.sequence === 'number' ? parsed.sequence : Date.now(),
      event_type: parsed.event_type || eventType,
      payload: parsed.payload || {},
      created_at: parsed.created_at || new Date().toISOString(),
    };

    onEvent?.(event);

    if (event.event_type === 'pipeline.result') {
      finalResponse = event.payload as unknown as PipelineResponse;
    }

    if (event.event_type === 'error') {
      throw new Error(String(event.payload?.detail || 'Pipeline execution failed'));
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      if (part.trim()) {
        flushEventBlock(part);
      }
    }
  }

  if (buffer.trim()) {
    flushEventBlock(buffer);
  }

  if (!finalResponse) {
    throw new Error('Pipeline stream ended without a final result');
  }

  return finalResponse;
}

export async function getRun(runId: string): Promise<RunDetailResponse> {
  return fetchAPI(`/runs/${encodeURIComponent(runId)}`);
}

export async function generateProposalRevisionBatch(data: {
  project_id?: string;
  proposal_document_id?: string;
  proposal_title?: string;
  proposal_text?: string;
  critique_markdown: string;
  output_format?: ProposalRevisionFormat;
  apply_all?: boolean;
  target_sections?: string[];
  target_agents?: string[];
  constraints?: Record<string, unknown>;
}): Promise<ProposalRevisionBatchResponse> {
  return fetchAPI('/proposals/revise/generate', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getProposalRevisionBatch(
  batchId: string,
  params?: {
    filter_by_agent?: string[];
    filter_by_section?: string[];
    filter_by_impact?: string[];
  },
): Promise<ProposalRevisionBatchResponse> {
  const qs = new URLSearchParams();
  for (const agent of params?.filter_by_agent || []) qs.append('filter_by_agent', agent);
  for (const section of params?.filter_by_section || []) qs.append('filter_by_section', section);
  for (const impact of params?.filter_by_impact || []) qs.append('filter_by_impact', impact);
  const query = qs.toString();
  return fetchAPI(`/proposals/revise/batch/${encodeURIComponent(batchId)}${query ? `?${query}` : ''}`);
}

export async function reviewProposalRevisionBatch(
  batchId: string,
  data: {
    batch_id: string;
    output_format?: ProposalRevisionFormat;
    decisions: Record<string, 'accept' | 'reject' | 'modify'>;
    modifications?: Record<string, string>;
    accept_all_by_agent?: string[];
    reject_all_by_agent?: string[];
    accept_all_by_section?: string[];
    reject_all_by_section?: string[];
    accept_all_by_impact?: string[];
  },
): Promise<ProposalRevisionFinalResponse> {
  return fetchAPI(`/proposals/revise/batch/${encodeURIComponent(batchId)}/review`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function rerunProposalRevisionAgent(
  batchId: string,
  data: {
    agent_name: string;
    constraints?: Record<string, unknown>;
  },
): Promise<ProposalRevisionBatchResponse> {
  return fetchAPI(`/proposals/revise/batch/${encodeURIComponent(batchId)}/rerun-agent`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getProposalRevisionAudit(batchId: string): Promise<ProposalRevisionAuditResponse> {
  return fetchAPI(`/proposals/revise/batch/${encodeURIComponent(batchId)}/audit`);
}

export async function getProposalRevisionFormats(
  batchId: string,
  format: ProposalRevisionFormat,
): Promise<ProposalRevisionFormatResponse> {
  return fetchAPI(`/proposals/revise/formats/${encodeURIComponent(batchId)}?format=${encodeURIComponent(format)}`);
}

// ── Search / Documents ──────────────────────────────────────────────

export async function searchDocuments(data: { query: string; project_id?: string; n_results?: number }): Promise<SearchResponse>;
export async function searchDocuments(query: string, projectId?: string, nResults?: number): Promise<SearchResponse>;
export async function searchDocuments(
  dataOrQuery: { query: string; project_id?: string; n_results?: number } | string,
  projectId?: string,
  nResults?: number,
) {
  const data = typeof dataOrQuery === 'string'
    ? { query: dataOrQuery, project_id: projectId, n_results: nResults }
    : dataOrQuery;
  return fetchAPI('/search', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function uploadDocument(
  file: File,
  projectId = 'default',
  options?: { sourcePath?: string },
): Promise<DocumentUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('project_id', projectId);
  if (options?.sourcePath) {
    form.append('source_path', options.sourcePath);
  }
  const res = await fetch(`${API_BASE_URL}/documents/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const payload = await res.json();
      if (typeof payload?.detail === 'string' && payload.detail.trim()) {
        detail = payload.detail;
      }
    } catch {
      // Keep the status text when the response body is not JSON.
    }
    throw new Error(`Upload failed: ${detail}`);
  }
  return res.json() as Promise<DocumentUploadResponse>;
}

export async function listProjectDocuments(
  projectId: string,
  options?: { skip?: number; limit?: number },
): Promise<ProjectDocumentListResponse> {
  const qs = new URLSearchParams();
  if (typeof options?.skip === 'number') {
    qs.set('skip', String(options.skip));
  }
  if (typeof options?.limit === 'number') {
    qs.set('limit', String(options.limit));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return fetchAPI(`/documents/${encodeURIComponent(projectId)}${suffix}`);
}

export async function deleteProjectDocument(documentId: string): Promise<{ message: string; success: boolean }> {
  return fetchAPI(`/documents/${encodeURIComponent(documentId)}`, {
    method: 'DELETE',
  });
}

// ── Deep Research & Library ─────────────────────────────────────────

export async function deepResearch(data: {
  topic: string;
  project_id?: string;
  max_papers?: number;
  download_pdfs?: boolean;
  evidence_mode?: 'abstracts' | 'web' | 'pdf';
  persist_evidence_to_rag?: boolean;
  use_rag?: boolean;
  save_to_rag?: boolean;
  sources?: string[];
  report_type?: string;
  report_models?: string[];
  synthesis_model?: string;
}): Promise<DeepResearchResult>;
export async function deepResearch(
  topic: string,
  options?: {
    project_id?: string;
    max_papers?: number;
    download_pdfs?: boolean;
    evidence_mode?: 'abstracts' | 'web' | 'pdf';
    persist_evidence_to_rag?: boolean;
    use_rag?: boolean;
    save_to_rag?: boolean;
    sources?: string[];
    report_type?: string;
    report_models?: string[];
    synthesis_model?: string;
  },
): Promise<DeepResearchResult>;
export async function deepResearch(
  dataOrTopic: {
    topic: string;
    project_id?: string;
    max_papers?: number;
    download_pdfs?: boolean;
    evidence_mode?: 'abstracts' | 'web' | 'pdf';
    persist_evidence_to_rag?: boolean;
    use_rag?: boolean;
    save_to_rag?: boolean;
    sources?: string[];
    report_type?: string;
    report_models?: string[];
    synthesis_model?: string;
  } | string,
  options?: {
    project_id?: string;
    max_papers?: number;
    download_pdfs?: boolean;
    evidence_mode?: 'abstracts' | 'web' | 'pdf';
    persist_evidence_to_rag?: boolean;
    use_rag?: boolean;
    save_to_rag?: boolean;
    sources?: string[];
    report_type?: string;
    report_models?: string[];
    synthesis_model?: string;
  },
): Promise<DeepResearchResult> {
  const data = typeof dataOrTopic === 'string' ? { topic: dataOrTopic, ...(options || {}) } : dataOrTopic;
  return fetchAPI('/research/deep', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function searchPubMed(data: {
  query: string;
  max_results?: number;
  sort?: string;
  min_date?: string;
  max_date?: string;
  project_id?: string;
}): Promise<PubMedSearchResult>;
export async function searchPubMed(query: string, max_results?: number): Promise<PubMedSearchResult>;
export async function searchPubMed(
  dataOrQuery: {
    query: string;
    max_results?: number;
    sort?: string;
    min_date?: string;
    max_date?: string;
    project_id?: string;
  } | string,
  max_results?: number,
): Promise<PubMedSearchResult> {
  const data = typeof dataOrQuery === 'string' ? { query: dataOrQuery, max_results } : dataOrQuery;
  return fetchAPI('/research/search/pubmed', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function searchAcademic(data: {
  query: string;
  max_results?: number;
  sources?: string[];
  project_id?: string;
}): Promise<AcademicResult>;
export async function searchAcademic(query: string, max_results?: number, sources?: string[]): Promise<AcademicResult>;
export async function searchAcademic(
  dataOrQuery: {
    query: string;
    max_results?: number;
    sources?: string[];
    project_id?: string;
  } | string,
  max_results?: number,
  sources?: string[],
): Promise<AcademicResult> {
  const data = typeof dataOrQuery === 'string' ? { query: dataOrQuery, max_results, sources } : dataOrQuery;
  return fetchAPI('/research/search/academic', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listLiteratureSearchHistory(params?: {
  project_id?: string;
  source_type?: string;
  triggered_by?: string;
  limit?: number;
}): Promise<LiteratureSearchHistoryResponse> {
  const qs = new URLSearchParams();
  if (params?.project_id) qs.set('project_id', params.project_id);
  if (params?.source_type) qs.set('source_type', params.source_type);
  if (params?.triggered_by) qs.set('triggered_by', params.triggered_by);
  if (typeof params?.limit === 'number') qs.set('limit', String(params.limit));
  const query = qs.toString();
  return fetchAPI(`/research/search/history${query ? `?${query}` : ''}`);
}

export async function getLiteratureSearchHistory(searchId: string): Promise<LiteratureSearchHistoryDetail> {
  return fetchAPI(`/research/search/history/${encodeURIComponent(searchId)}`);
}

export async function ragQuery(data: { question: string; top_k?: number; project_id?: string }): Promise<RAGAnswer>;
export async function ragQuery(question: string, top_k?: number): Promise<RAGAnswer>;
export async function ragQuery(
  dataOrQuestion: { question: string; top_k?: number; project_id?: string } | string,
  top_k?: number,
): Promise<RAGAnswer> {
  const data = typeof dataOrQuestion === 'string' ? { question: dataOrQuestion, top_k } : dataOrQuestion;
  return fetchAPI('/research/rag/query', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function compileDeepResearchPrompt(data: {
  project_id?: string;
  title?: string;
  description?: string;
  epistemic_baseline: string;
  target_gap: string;
  exclusion_criteria?: string[];
  additional_context?: string;
  tags?: string[];
  save_prompt?: boolean;
  write_to_file?: boolean;
}): Promise<DeepResearchPromptCompileResponse> {
  return fetchAPI('/research/deep/prompts/compile', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listDeepResearchPrompts(params?: {
  project_id?: string;
  tag?: string;
  limit?: number;
}): Promise<DeepResearchPrompt[]> {
  const qs = new URLSearchParams();
  if (params?.project_id) qs.set('project_id', params.project_id);
  if (params?.tag) qs.set('tag', params.tag);
  if (typeof params?.limit === 'number') qs.set('limit', String(params.limit));
  const query = qs.toString();
  return fetchAPI(`/research/deep/prompts${query ? `?${query}` : ''}`);
}

export async function listRepoPromptLibrary(params?: {
  tag?: string;
  prompt_kind?: string;
}): Promise<RepoPromptLibraryEntry[]> {
  const qs = new URLSearchParams();
  if (params?.tag) qs.set('tag', params.tag);
  if (params?.prompt_kind) qs.set('prompt_kind', params.prompt_kind);
  const query = qs.toString();
  return fetchAPI(`/research/deep/prompts/library${query ? `?${query}` : ''}`);
}

export async function createSavedPrompt(data: {
  project_id?: string;
  title: string;
  description?: string;
  prompt_text: string;
  prompt_kind?: string;
  source_type?: string;
  tags?: string[];
  prompt_context?: Record<string, unknown>;
}): Promise<SavedPrompt> {
  return fetchAPI('/prompts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function listSavedPrompts(params?: {
  project_id?: string;
  prompt_kind?: string;
  tag?: string;
  limit?: number;
}): Promise<SavedPrompt[]> {
  const qs = new URLSearchParams();
  if (params?.project_id) qs.set('project_id', params.project_id);
  if (params?.prompt_kind) qs.set('prompt_kind', params.prompt_kind);
  if (params?.tag) qs.set('tag', params.tag);
  if (typeof params?.limit === 'number') qs.set('limit', String(params.limit));
  const query = qs.toString();
  return fetchAPI(`/prompts${query ? `?${query}` : ''}`);
}

export async function getSavedPrompt(promptId: string): Promise<SavedPrompt> {
  return fetchAPI(`/prompts/${encodeURIComponent(promptId)}`);
}

export async function updateSavedPrompt(
  promptId: string,
  data: {
    title?: string;
    description?: string;
    prompt_text?: string;
    prompt_kind?: string;
    source_type?: string;
    tags?: string[];
    prompt_context?: Record<string, unknown>;
    effectiveness_notes?: string;
    quality_rating?: number | null;
  },
): Promise<SavedPrompt> {
  return fetchAPI(`/prompts/${encodeURIComponent(promptId)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function listSavedPromptLibrary(params?: {
  tag?: string;
  prompt_kind?: string;
}): Promise<RepoPromptLibraryEntry[]> {
  const qs = new URLSearchParams();
  if (params?.tag) qs.set('tag', params.tag);
  if (params?.prompt_kind) qs.set('prompt_kind', params.prompt_kind);
  const query = qs.toString();
  return fetchAPI(`/prompts/library${query ? `?${query}` : ''}`);
}

export async function getDeepResearchPrompt(promptId: string): Promise<DeepResearchPrompt> {
  return fetchAPI(`/research/deep/prompts/${encodeURIComponent(promptId)}`);
}

export async function updateDeepResearchPrompt(
  promptId: string,
  data: {
    title?: string;
    description?: string;
    tags?: string[];
    effectiveness_notes?: string;
    quality_rating?: number | null;
  },
): Promise<DeepResearchPrompt> {
  return fetchAPI(`/research/deep/prompts/${encodeURIComponent(promptId)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function reuseDeepResearchPrompt(
  promptId: string,
  data: {
    project_id?: string;
    title?: string;
    description?: string;
    epistemic_baseline?: string;
    target_gap?: string;
    exclusion_criteria?: string[];
    additional_context?: string;
    tags?: string[];
    save_as_new?: boolean;
    write_to_file?: boolean;
  },
): Promise<DeepResearchPromptCompileResponse> {
  return fetchAPI(`/research/deep/prompts/${encodeURIComponent(promptId)}/reuse`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function reingestExternalDeepResearchReport(data: {
  project_id?: string;
  source_prompt_id?: string;
  report_text: string;
}): Promise<DeepResearchOffloadIngestResponse> {
  return fetchAPI('/research/deep/offload/reingest', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Office Exports ──────────────────────────────────────────────────

export async function exportDocx(data: { title: string; content: string }): Promise<Response>;
export async function exportDocx(title: string, content: string): Promise<Response>;
export async function exportDocx(dataOrTitle: { title: string; content: string } | string, content?: string) {
  const data = typeof dataOrTitle === 'string' ? { title: dataOrTitle, content: content || '' } : dataOrTitle;
  return fetchRaw('/office/export/docx', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function exportPptx(data: { title: string; content: string }): Promise<Response>;
export async function exportPptx(title: string, content: string): Promise<Response>;
export async function exportPptx(dataOrTitle: { title: string; content: string } | string, content?: string) {
  const data = typeof dataOrTitle === 'string' ? { title: dataOrTitle, content: content || '' } : dataOrTitle;
  return fetchRaw('/office/export/pptx', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function exportXlsx(data: { title: string; content: string; articles?: Record<string, unknown>[] }): Promise<Response>;
export async function exportXlsx(title: string, articles?: Record<string, unknown>[]): Promise<Response>;
export async function exportXlsx(
  dataOrTitle: { title: string; content: string; articles?: Record<string, unknown>[] } | string,
  articles?: Record<string, unknown>[],
) {
  const data = typeof dataOrTitle === 'string'
    ? { title: dataOrTitle, content: '', articles: articles || [] }
    : dataOrTitle;
  return fetchRaw('/office/export/xlsx', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Import / Ingestion ──────────────────────────────────────────────

export async function scanExternalDocs(subdir = '', recursive = true) {
  return fetchAPI(`/import/scan?subdir=${encodeURIComponent(subdir)}&recursive=${recursive}`);
}

export async function browseExternalDirs(subdir = '') {
  return fetchAPI(`/import/browse?subdir=${encodeURIComponent(subdir)}`);
}

export async function importFilesToProject(data: {
  project_id?: string;
  project_name?: string;
  project_description?: string;
  paths: string[];
}) {
  return fetchAPI('/import/ingest', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Experiment Design ───────────────────────────────────────────────

export async function runExperimentDesign(data: {
  question: string;
  proposed_method?: string;
  organism?: string;
  field_of_study?: string;
  project_id?: string;
}) {
  return fetchAPI('/experiment-design', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Scripts ─────────────────────────────────────────────────────────

export async function listScripts(params?: { project_id?: string; language?: string; tag?: string }): Promise<Script[]>;
export async function listScripts(project_id?: string, language?: string, tag?: string): Promise<Script[]>;
export async function listScripts(
  paramsOrProjectId?: { project_id?: string; language?: string; tag?: string } | string,
  language?: string,
  tag?: string,
) {
  const params = typeof paramsOrProjectId === 'string'
    ? { project_id: paramsOrProjectId, language, tag }
    : paramsOrProjectId;
  const qs = new URLSearchParams();
  if (params?.project_id) qs.set('project_id', params.project_id);
  if (params?.language) qs.set('language', params.language);
  if (params?.tag) qs.set('tag', params.tag);
  const query = qs.toString();
  return fetchAPI(`/scripts${query ? `?${query}` : ''}`);
}

export async function createScript(data: {
  title: string;
  description?: string;
  language?: string;
  code?: string;
  tags?: string[];
  project_id?: string;
}) {
  return fetchAPI('/scripts', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateScript(
  scriptId: string,
  data: {
    title?: string;
    description?: string;
    language?: string;
    code?: string;
    tags?: string[];
    project_id?: string;
    lifecycle_state?: string;
  },
) {
  return fetchAPI(`/scripts/${encodeURIComponent(scriptId)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteScript(scriptId: string) {
  return fetchAPI(`/scripts/${encodeURIComponent(scriptId)}`, { method: 'DELETE' });
}

export async function importScript(data: {
  title: string;
  description?: string;
  language?: string;
  code: string;
  tags?: string[];
  project_id?: string;
  source_path?: string;
  safety_acknowledged: boolean;
}) {
  return fetchAPI('/scripts/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function composeScript(data: {
  prompt: string;
  language?: string;
  existing_script_id?: string;
  project_id?: string;
}) {
  return fetchAPI('/scripts/compose', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function interpretAnalysis(data: {
  code: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  task_description?: string;
  language?: string;
}) {
  return fetchAPI('/analysis/interpret', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Agents ──────────────────────────────────────────────────────────

export async function listAgents() {
  return fetchAPI('/agents');
}

export async function createAgent(data: {
  name: string;
  display_name: string;
  description?: string;
  system_prompt?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  tools?: string[];
  example_tasks?: string[];
}) {
  return fetchAPI('/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateAgent(
  agentId: string,
  data: {
    display_name?: string;
    description?: string;
    system_prompt?: string;
    model?: string;
    temperature?: number;
    max_tokens?: number;
    tools?: string[];
    example_tasks?: string[];
    is_active?: boolean;
  },
) {
  return fetchAPI(`/agents/${encodeURIComponent(agentId)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(agentId: string) {
  return fetchAPI(`/agents/${encodeURIComponent(agentId)}`, { method: 'DELETE' });
}

export async function listAgentCatalog() {
  return fetchAPI('/agents/catalog');
}

// ── Evidence Ledger ─────────────────────────────────────────────────

export async function fetchEvidenceLedger(projectId?: string, limit = 25) {
  const qs = new URLSearchParams();
  if (projectId) qs.set('project_id', projectId);
  qs.set('limit', String(limit));
  return fetchAPI(`/evidence/ledger?${qs.toString()}`);
}

export async function fetchRun(runId: string): Promise<RunDetailResponse> {
  return fetchAPI(`/runs/${encodeURIComponent(runId)}`);
}

// ── Model Routing ───────────────────────────────────────────────────

export async function getModelRoutingConfig(): Promise<ModelRoutingConfig> {
  return fetchAPI('/model-routing/config');
}

export async function updateModelRoutingConfig(data: {
  agent_overrides?: Record<string, string>;
  tier_overrides?: Record<string, string>;
  strategy?: string;
}): Promise<ModelRoutingConfig> {
  return fetchAPI('/model-routing/config', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function getApiKeys(): Promise<{ keys: ProviderApiKeyStatus[] }> {
  return fetchAPI('/api-keys');
}

export async function updateApiKey(data: {
  provider: string;
  key: string;
}): Promise<ProviderApiKeyStatus> {
  return fetchAPI('/api-keys', {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function listModelCatalog(vendor?: string): Promise<{ models: ModelCatalogEntry[]; total: number }> {
  const qs = vendor ? `?vendor=${encodeURIComponent(vendor)}` : '';
  return fetchAPI(`/model-catalog${qs}`);
}

export async function refreshModelCatalog(): Promise<{ ok: boolean; models_updated: number }> {
  return fetchAPI('/model-catalog/refresh', {
    method: 'POST',
  });
}

// ── Ollama Bootstrap ────────────────────────────────────────────────

export async function getOllamaBootstrapStatus(): Promise<OllamaBootstrapStatus> {
  return fetchAPI('/providers/ollama/bootstrap');
}

export async function startOllamaBootstrap(model?: string): Promise<OllamaBootstrapStatus> {
  return fetchAPI('/providers/ollama/bootstrap', {
    method: 'POST',
    body: JSON.stringify({ model: model || 'llama3.2:3b' }),
  });
}

// ── Figure Media ────────────────────────────────────────────────────

export async function generateFigureCaption(data: {
  figure_description: string;
  research_context?: string;
  style?: string;
}) {
  return fetchAPI('/figures/media/caption', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function generateAudioOverview(data: {
  text: string;
  title?: string;
  instructions?: string;
}) {
  return fetchAPI('/figures/media/audio-overview', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function generateNarrationScript(data: {
  figure_description: string;
  audience?: string;
  duration_seconds?: number;
}) {
  return fetchAPI('/figures/media/narration', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function generateVisDescription(data: {
  data_description: string;
  chart_type?: string;
}) {
  return fetchAPI('/figures/media/visualization', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── ELNOTE ──────────────────────────────────────────────────────────

export async function getElnoteStatus() {
  return fetchAPI('/elnote/status');
}

export async function pushToElnote(data: {
  project_id: string;
  title: string;
  content: string;
  entry_type?: string;
  artifact_filename?: string;
  artifact_b64?: string;
  artifact_mime?: string;
  metadata?: Record<string, unknown>;
}) {
  return fetchAPI('/elnote/push', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Email ───────────────────────────────────────────────────────────

export async function listEmails(params?: {
  folder?: string;
  priority?: string;
  unread_only?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Email[]> {
  const qs = new URLSearchParams();
  if (params?.folder) qs.set('folder', params.folder);
  if (params?.priority) qs.set('priority', params.priority);
  if (params?.unread_only) qs.set('unread_only', 'true');
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return fetchAPI(`/emails${query ? `?${query}` : ''}`);
}

export async function getEmailUnreadCount(): Promise<{ count: number }> {
  return fetchAPI('/emails/unread-count');
}

export async function getEmailConfigStatus() {
  return fetchAPI('/emails/config/status');
}

export async function fetchNewEmails(folder = 'INBOX', limit = 50) {
  return fetchAPI(`/emails/fetch?folder=${encodeURIComponent(folder)}&limit=${limit}`, {
    method: 'POST',
  });
}

export async function markEmailRead(emailId: string) {
  return fetchAPI(`/emails/${encodeURIComponent(emailId)}/read`, { method: 'POST' });
}

export async function flagEmail(emailId: string, flagged = true) {
  return fetchAPI(`/emails/${encodeURIComponent(emailId)}/flag?flagged=${flagged}`, {
    method: 'POST',
  });
}

export async function triageEmail(emailId: string) {
  return fetchAPI(`/emails/${encodeURIComponent(emailId)}/triage`, { method: 'POST' });
}

export async function triageBatch(emailIds?: string[]) {
  return fetchAPI('/emails/triage-batch', {
    method: 'POST',
    body: JSON.stringify(emailIds ?? null),
  });
}

// ── Calendar ────────────────────────────────────────────────────────

export async function listCalendarEvents(params?: {
  start?: string;
  end?: string;
  calendar_name?: string;
  limit?: number;
}): Promise<CalendarEvent[]> {
  const qs = new URLSearchParams();
  if (params?.start) qs.set('start', params.start);
  if (params?.end) qs.set('end', params.end);
  if (params?.calendar_name) qs.set('calendar_name', params.calendar_name);
  if (params?.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return fetchAPI(`/calendar/events${query ? `?${query}` : ''}`);
}

export async function getUpcomingEvents(hours = 24): Promise<CalendarEvent[]> {
  return fetchAPI(`/calendar/upcoming?hours=${hours}`);
}

export async function createCalendarEvent(data: {
  title: string;
  start_time: string;
  end_time?: string;
  description?: string;
  location?: string;
  all_day?: boolean;
  calendar_name?: string;
  color?: string;
}): Promise<CalendarEvent> {
  return fetchAPI('/calendar/events', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteCalendarEvent(eventId: string) {
  return fetchAPI(`/calendar/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
}

// ── Scheduler ───────────────────────────────────────────────────────

export async function listScheduledTasks(params?: {
  task_type?: string;
  enabled_only?: boolean;
}): Promise<ScheduledTask[]> {
  const qs = new URLSearchParams();
  if (params?.task_type) qs.set('task_type', params.task_type);
  if (params?.enabled_only) qs.set('enabled_only', 'true');
  const query = qs.toString();
  return fetchAPI(`/scheduler/tasks${query ? `?${query}` : ''}`);
}

export async function createScoutTask(data: { project_id: string; interval_hours?: number }): Promise<ScheduledTask> {
  return fetchAPI('/scheduler/tasks/scout', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function toggleScheduledTask(taskId: string, enabled: boolean): Promise<ScheduledTask> {
  return fetchAPI(`/scheduler/tasks/${encodeURIComponent(taskId)}/toggle?enabled=${enabled}`, {
    method: 'POST',
  });
}

export async function runTaskNow(taskId: string): Promise<ScheduledTask> {
  return fetchAPI(`/scheduler/tasks/${encodeURIComponent(taskId)}/run`, { method: 'POST' });
}

export async function deleteScheduledTask(taskId: string) {
  return fetchAPI(`/scheduler/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export async function getSchedulerStatus() {
  return fetchAPI('/scheduler/status');
}

// ── Bioinformatics Pipeline Templates ───────────────────────────────

export async function listBioPipelineTemplates(params?: { category?: string; organism?: string }) {
  const qs = new URLSearchParams();
  if (params?.category) qs.set('category', params.category);
  if (params?.organism) qs.set('organism', params.organism);
  const query = qs.toString();
  return fetchAPI(`/bio-pipelines/templates${query ? `?${query}` : ''}`);
}

export async function createBioPipelineTemplate(data: {
  name: string;
  display_name: string;
  description?: string;
  category: string;
  organism?: string;
  tools?: string[];
  steps?: { name: string; tool: string; description?: string; params?: Record<string, unknown>; depends_on?: string[] }[];
  default_params?: Record<string, unknown>;
  reference_url?: string;
  reference_doi?: string;
}) {
  return fetchAPI('/bio-pipelines/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteBioPipelineTemplate(templateId: string) {
  return fetchAPI(`/bio-pipelines/templates/${templateId}`, { method: 'DELETE' });
}

export async function designBioPipeline(data: {
  goal: string;
  organism?: string;
  optional_constraints?: string;
  project_id?: string;
}) {
  return fetchAPI('/bio-pipelines/design', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function searchPublicData(data: {
  query: string;
  databases?: string[];
  organism?: string;
  max_results?: number;
}) {
  return fetchAPI('/bio-pipelines/data-search', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function planBioPipelineAssisted(data: {
  goal: string;
  organism?: string;
  optional_constraints?: string;
  dataset_query?: string;
  databases?: string[];
  max_results?: number;
  project_id?: string;
}): Promise<BioPipelineAssistedAdvisorResponse> {
  return fetchAPI('/bio-pipelines/assisted-advisor', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function runBioPipelineAssisted(data: {
  goal: string;
  organism?: string;
  optional_constraints?: string;
  language?: 'python';
  project_id?: string;
  recommended_steps?: BioPipelineStep[];
  selected_datasets?: Array<PublicDataRecord | BioPipelineDatasetRecommendation>;
}): Promise<BioPipelineAssistedRunResponse> {
  return fetchAPI('/bio-pipelines/assisted-run', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function generatePipelineCode(data: {
  goal: string;
  steps?: { name: string; tool: string; description?: string; params?: Record<string, unknown>; depends_on?: string[] }[];
  language?: string;
  organism?: string;
  data_accessions?: string[];
}) {
  return fetchAPI('/bio-pipelines/generate-code', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function generateBioVisualization(data: {
  analysis_type: string;
  description?: string;
  sample_data?: Record<string, unknown>;
  organism?: string;
}) {
  return fetchAPI('/bio-pipelines/visualize', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function pipelineAdvisorChat(data: {
  goal: string;
  organism?: string;
  optional_constraints?: string;
}) {
  return fetchAPI('/bio-pipelines/advisor', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Presentation Workshop ───────────────────────────────────────────

export async function generatePresentationPlan(data: {
  theme: string;
  audience: string;
  project_id?: string;
  sources?: string[];
  duration_minutes?: number;
}) {
  return fetchAPI('/presentations/plan', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function generateInfographic(data: {
  topic: string;
  key_points: string[];
  style?: string;
  audience?: string;
}) {
  return fetchAPI('/presentations/infographic', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function generateVideoScript(data: {
  topic: string;
  narration_style?: string;
  duration_seconds?: number;
  audience?: string;
  key_points?: string[];
}) {
  return fetchAPI('/presentations/video-script', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function gatherWebContent(data: {
  url: string;
  extract_type?: string;
}) {
  return fetchAPI('/presentations/gather-web', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
