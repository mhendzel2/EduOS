export type Domain = 'writing' | 'web' | 'youtube';
export type PipelineKind = 'writing' | 'media' | 'promo' | 'custom';

export interface StudioProject {
  id: string;
  name: string;
  description?: string;
  domains: Domain[];
  story_bible?: StoryBible;
  brand_bible?: BrandBible;
  created_at: string;
  updated_at?: string;
  run_count?: number;
  artifact_count?: number;
  document_count?: number;
}

export interface StoryBible {
  characters: Record<string, CharacterProfile>;
  continuity: ContinuityRecord[];
  timeline: TimelineEvent[];
  lore_rules: string[];
  spoiler_boundary?: string;
  latest_outline?: string;
}

export interface CharacterProfile {
  name: string;
  role: string;
  description: string;
  motivation: string;
  voice_notes: string;
  arc_status: string;
}

export interface ContinuityRecord {
  fact: string;
  established_in: string;
  canon: boolean;
}

export interface TimelineEvent {
  event: string;
  chapter: string;
  timestamp?: string;
}

export interface BrandBible {
  brand_name: string;
  voice_tone: string;
  style_guide: Record<string, string>;
  audience_personas: AudiencePersona[];
  off_brand_examples: string[];
  published_content_index: ContentIndexEntry[];
}

export interface AudiencePersona {
  name: string;
  description: string;
  content_preferences: string[];
}

export interface ContentIndexEntry {
  title: string;
  platform: string;
  url?: string;
  published_at: string;
  topics: string[];
}

export interface Artifact {
  id: string;
  project_id: string;
  run_id?: string;
  artifact_type: string;
  content?: string;
  metadata?: Record<string, unknown>;
  version: number;
  created_at: string;
}

export interface GateVerdict {
  passed: boolean;
  reason: string;
  revisions: string[];
  blocking: boolean;
}

export interface GateResult {
  gate_agent: string;
  artifact_type: string;
  verdict: GateVerdict;
}

export interface WorkforceStatus {
  domains: Domain[];
  active_workforces: string[];
  agents: Record<string, string[]>;
}

export interface RunEvent {
  sequence: number;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface RunRecord {
  id: string;
  project_id: string;
  run_type: string;
  task: string;
  requested_agent?: string | null;
  status: string;
  context: Record<string, unknown>;
  final_output?: string | null;
  error?: string | null;
  metadata: Record<string, unknown>;
  started_at: string;
  completed_at?: string | null;
  events: RunEvent[];
}

export interface PipelineStepResult {
  step_num: number;
  agent: string;
  description: string;
  artifact_type?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  gate_result?: GateResult;
}

export interface PipelineRunResponse {
  run: RunRecord;
  plan: {
    task: string;
    pipeline_kind: PipelineKind;
    task_type: string;
    steps: Array<Record<string, unknown>>;
  };
  final_output: string;
  success: boolean;
  errors: string[];
  results: PipelineStepResult[];
}

export interface PipelineBuilderStep {
  workforce: string;
  agent_id: string;
  description?: string | null;
  artifact_type?: string | null;
  requires_artifacts: string[];
  is_gate: boolean;
  gate_input_artifact?: string | null;
}

export interface ProjectAgentRunResponse {
  run: RunRecord;
  response: AgentResponsePayload;
  artifact?: Artifact | null;
}

export interface ProjectDocumentItem {
  id: string;
  project_id: string;
  filename: string;
  path: string;
  size: number;
  content_type: string;
  source_path?: string | null;
  is_reference: boolean;
  version: number;
  created_at: string;
  url: string;
}

export interface UploadDocumentResponse extends ProjectDocumentItem {
  document_id: string;
}

export interface ProjectImportResponse {
  project_id: string;
  normalized_source_path: string;
  mode: 'copy' | 'reference';
  selected_files: number;
  imported: number;
  skipped_existing: number;
  indexing_failed: number;
}

export interface ProjectInboxStatus {
  project_id: string;
  inbox_path: string;
  exists: boolean;
  importable_file_count: number;
  sample_files: string[];
}

export interface ProjectWebsiteImportResponse {
  project_id: string;
  normalized_site_url: string;
  selected_pages: number;
  imported: number;
  skipped_existing: number;
  indexing_failed: number;
}

export interface MediaToolSettingsItem {
  tool_id: string;
  name: string;
  provider: string;
  category: 'mcp' | 'local_tool';
  description: string;
  capabilities: string[];
  install_command: string;
  notes: string[];
  auth_required: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
  runtime_available: boolean;
  runtime_ready: boolean;
  runtime_message: string;
  supported_actions: string[];
}

export interface ProjectMediaToolSettings {
  project_id: string;
  tools: MediaToolSettingsItem[];
  created_at: string;
  updated_at: string;
}

export interface MediaToolActionResponse {
  project_id: string;
  tool_id: string;
  action: string;
  success: boolean;
  executed: boolean;
  message: string;
  output_document?: ProjectDocumentItem | null;
  artifact?: Artifact | null;
  command: string[];
  metadata: Record<string, unknown>;
}

export interface SearchResultItem {
  document_id: string;
  filename: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export interface HealthResponse {
  status: string;
  version: string;
  coordinator: string;
  domains: Domain[];
  database_url: string;
  upload_dir: string;
}

export interface AgentResponsePayload {
  agent_name: string;
  content: string;
  artifact_type?: string | null;
  action_items?: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export interface PromptTemplate {
  id: string;
  project_id?: string | null;
  name: string;
  slug: string;
  category: string;
  target_kind: string;
  description: string;
  system_prompt: string;
  user_prompt_template: string;
  tags: string[];
  metadata: Record<string, unknown>;
  is_builtin: boolean;
  feedback_summary?: PromptTemplateFeedbackSummary | null;
  created_at: string;
  updated_at: string;
}

export interface PromptTemplateFeedbackSummary {
  feedback_count: number;
  average_score: number;
  positive_feedback_count: number;
  negative_feedback_count: number;
  reuse_rate?: number | null;
  common_strengths: string[];
  common_failures: string[];
  latest_feedback_at?: string | null;
}

export interface PromptFeedback {
  id: string;
  prompt_template_id: string;
  project_id?: string | null;
  run_id?: string | null;
  feedback_source: string;
  score: number;
  would_reuse?: boolean | null;
  use_case: string;
  strengths: string[];
  failure_modes: string[];
  notes: string;
  task_input: string;
  output_excerpt: string;
  metadata: Record<string, unknown>;
  system_prompt_snapshot: string;
  user_prompt_template_snapshot: string;
  created_at: string;
}

export interface PromptFeedbackListResponse {
  template_id: string;
  summary?: PromptTemplateFeedbackSummary | null;
  feedback: PromptFeedback[];
}

export interface PromptOptimizationResult {
  template_id: string;
  optimized_name: string;
  system_prompt: string;
  user_prompt_template: string;
  rationale: string;
  changes: string[];
  metadata_updates: Record<string, unknown>;
  feedback_summary?: PromptTemplateFeedbackSummary | null;
  created_prompt?: PromptTemplate | null;
}

export interface BrandAutocompleteResponse {
  project_id: string;
  field: string;
  prompt_template_id: string;
  prompt_template_name: string;
  suggestions: Partial<BrandBible>;
  rationale: string;
  context_documents: string[];
}

export interface ProjectMemory {
  project_id: string;
  summary: string;
  pinned_facts: string[];
  active_token_estimate: number;
  compaction_count: number;
  last_compacted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMemory {
  id: string;
  summary: string;
  pinned_facts: string[];
  active_token_estimate: number;
  compaction_count: number;
  last_compacted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryAutocompleteResult {
  scope: 'workspace' | 'project';
  project_id?: string | null;
  prompt_template_id: string;
  prompt_template_name: string;
  summary: string;
  pinned_facts: string[];
  rationale: string;
  context_sources: string[];
}

export interface OllamaBootstrapStatus {
  state: 'idle' | 'running' | 'succeeded' | 'failed';
  base_url: string;
  model: string;
  connected: boolean;
  available_models: string[];
  target_model_available: boolean;
  message: string;
  started_at?: string | null;
  completed_at?: string | null;
  log: string[];
}

export interface ModelProviderStatus {
  name: string;
  configured: boolean;
  base_url: string;
  models: string[];
}

export interface ModelRoutingConfig {
  agent_overrides: Record<string, string>;
  tier_overrides: Record<string, string>;
  defaults: Record<string, string[]>;
  agent_tier_map: Record<string, string>;
  strategy: string;
  strategies: string[];
  supported_models: string[];
  tiers: string[];
  providers: ModelProviderStatus[];
  model_costs: Record<string, { input: number; output: number }>;
}

export interface TelegramControlStatus {
  enabled: boolean;
  polling_enabled: boolean;
  running: boolean;
  allowed_chat_count: number;
  default_project_id: string;
  default_project_name: string;
  default_project_resolved: boolean;
  default_scope: 'workspace' | 'media' | 'general';
  active_session_count: number;
  webhook_secret_configured: boolean;
}

export interface WorkflowCommandPlanStep {
  workforce: string;
  agent_id: string;
  description: string;
  artifact_type?: string | null;
  requires_artifacts: string[];
  is_gate: boolean;
  gate_input_artifact?: string | null;
}

export interface WorkflowCommandPlan {
  summary: string;
  rationale: string;
  execution_mode: 'agent' | 'pipeline' | 'pipeline_builder';
  task: string;
  pipeline_kind?: string | null;
  workforce?: string | null;
  agent_id?: string | null;
  steps: WorkflowCommandPlanStep[];
  context_focus: string[];
  referenced_document_ids: string[];
  referenced_artifact_ids: string[];
}

export interface WorkflowCommandExecution {
  mode: 'agent' | 'pipeline' | 'pipeline_builder';
  run: RunRecord;
  final_output: string;
  agent_response?: AgentResponsePayload | null;
  artifact?: Artifact | null;
  pipeline_success?: boolean | null;
  pipeline_errors: string[];
  pipeline_results: Array<Record<string, unknown>>;
}

export interface WorkflowCommandResponse {
  project_id: string;
  command: string;
  scope: 'workspace' | 'media' | 'general';
  model: string;
  plan: WorkflowCommandPlan;
  execution?: WorkflowCommandExecution | null;
}

export interface ProjectChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface MultimodalCacheStatus {
  cached_vision_filenames: string[];
  generated_vision_filenames: string[];
  cached_transcript_filenames: string[];
  generated_transcript_filenames: string[];
}

export interface ProjectChatResponse {
  project_id: string;
  scope: 'workspace' | 'media' | 'general';
  message: string;
  model_target: 'local' | 'openrouter';
  model: string;
  planner_model: string;
  assistant_message: string;
  vision_enabled: boolean;
  used_vision_filenames: string[];
  audio_transcription_enabled: boolean;
  used_transcript_filenames: string[];
  multimodal_cache: MultimodalCacheStatus;
  plan: WorkflowCommandPlan;
  execution?: WorkflowCommandExecution | null;
  referenced_documents: ProjectDocumentItem[];
  referenced_artifacts: Artifact[];
}
