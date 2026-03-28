from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str
    coordinator: str
    domains: list[str]
    database_url: str
    upload_dir: str


class GoogleOAuthClientStatusResponse(BaseModel):
    configured: bool
    discovered: bool
    path: str = ""
    exists: bool
    valid: bool
    client_type: str = ""
    project_id: str = ""
    client_id_hint: str = ""
    redirect_uri_count: int = 0
    auth_uri_present: bool = False
    token_uri_present: bool = False
    message: str = ""


class TelegramControlStatusResponse(BaseModel):
    enabled: bool
    polling_enabled: bool
    running: bool
    allowed_chat_count: int
    default_project_id: str
    default_project_name: str = ""
    default_project_resolved: bool = False
    default_scope: Literal["workspace", "media", "general"]
    active_session_count: int
    webhook_secret_configured: bool


class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    domains: list[str] = Field(default_factory=list)
    story_bible: dict[str, Any] = Field(default_factory=dict)
    brand_bible: dict[str, Any] = Field(default_factory=dict)


class ProjectResponse(BaseModel):
    id: str
    name: str
    description: str
    domains: list[str]
    story_bible: dict[str, Any]
    brand_bible: dict[str, Any]
    created_at: datetime
    updated_at: datetime
    run_count: int = 0
    artifact_count: int = 0
    document_count: int = 0


class DocumentProvenanceResponse(BaseModel):
    source_type: str
    source_identifier: str = ""
    source_url: str = ""
    citation: str = ""
    authors: list[str] = Field(default_factory=list)
    published_at: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class ProjectDocumentResponse(BaseModel):
    id: str
    project_id: str
    filename: str
    path: str
    size: int
    content_type: str
    source_path: Optional[str] = None
    is_reference: bool = False
    version: int = 1
    created_at: datetime
    url: str
    provenance: Optional[DocumentProvenanceResponse] = None


class ProjectDocumentsResponse(BaseModel):
    documents: list[ProjectDocumentResponse] = Field(default_factory=list)


class ProjectImportRequest(BaseModel):
    source_path: str
    mode: Literal["copy", "reference"] = "reference"
    recursive: bool = True


class ProjectImportResponse(BaseModel):
    project_id: str
    normalized_source_path: str
    mode: Literal["copy", "reference"]
    selected_files: int
    imported: int
    skipped_existing: int
    indexing_failed: int


class ProjectInboxStatusResponse(BaseModel):
    project_id: str
    inbox_path: str
    exists: bool
    importable_file_count: int
    sample_files: list[str] = Field(default_factory=list)


class ProjectWebsiteImportRequest(BaseModel):
    site_url: str
    max_pages: int = 25


class ProjectWebsiteImportResponse(BaseModel):
    project_id: str
    normalized_site_url: str
    selected_pages: int
    imported: int
    skipped_existing: int
    indexing_failed: int


class StructuredDocumentCreateRequest(BaseModel):
    title: str
    abstract: str = ""
    content: str = ""
    source_type: str = "structured"
    source_identifier: str = ""
    source_url: str = ""
    citation: str = ""
    authors: list[str] = Field(default_factory=list)
    published_at: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    filename: Optional[str] = None


class MediaToolSettingsUpdateItem(BaseModel):
    tool_id: str
    enabled: bool = False
    config: dict[str, Any] = Field(default_factory=dict)


class ProjectMediaToolSettingsUpdateRequest(BaseModel):
    tools: list[MediaToolSettingsUpdateItem] = Field(default_factory=list)


class MediaToolSettingsResponseItem(BaseModel):
    tool_id: str
    name: str
    provider: str
    category: Literal["mcp", "local_tool"]
    description: str
    capabilities: list[str] = Field(default_factory=list)
    install_command: str = ""
    notes: list[str] = Field(default_factory=list)
    auth_required: bool = False
    enabled: bool = False
    config: dict[str, Any] = Field(default_factory=dict)
    runtime_available: bool = False
    runtime_ready: bool = False
    runtime_message: str = ""
    supported_actions: list[str] = Field(default_factory=list)


class ProjectMediaToolSettingsResponse(BaseModel):
    project_id: str
    tools: list[MediaToolSettingsResponseItem] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class MediaToolActionRequest(BaseModel):
    action: str
    document_id: Optional[str] = None
    secondary_document_id: Optional[str] = None
    arguments: dict[str, Any] = Field(default_factory=dict)

class DocumentSearchResultResponse(BaseModel):
    document_id: str
    filename: str = ""
    content: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentSearchResponse(BaseModel):
    query: str
    results: list[DocumentSearchResultResponse] = Field(default_factory=list)


class ArtifactResponse(BaseModel):
    id: str
    project_id: str
    run_id: Optional[str]
    artifact_type: str
    content: Optional[str]
    metadata: dict[str, Any] = Field(default_factory=dict)
    version: int
    created_at: datetime


class MediaAssetResponse(BaseModel):
    id: str
    project_id: str
    run_id: Optional[str] = None
    render_job_id: Optional[str] = None
    document_id: Optional[str] = None
    artifact_id: Optional[str] = None
    kind: str
    role: str
    storage_uri: str
    sha256: str = ""
    size_bytes: int = 0
    mime_type: str
    license: str = ""
    created_by: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    document: Optional[ProjectDocumentResponse] = None
    artifact: Optional[ArtifactResponse] = None


class MediaToolActionResponse(BaseModel):
    project_id: str
    tool_id: str
    action: str
    success: bool
    executed: bool
    message: str = ""
    output_document: Optional[ProjectDocumentResponse] = None
    artifact: Optional[ArtifactResponse] = None
    generated_documents: list[ProjectDocumentResponse] = Field(default_factory=list)
    generated_artifacts: list[ArtifactResponse] = Field(default_factory=list)
    generated_media_assets: list[MediaAssetResponse] = Field(default_factory=list)
    command: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentInvocationResponse(BaseModel):
    agent_name: str
    content: str
    artifact_type: Optional[str] = None
    action_items: list[str] = Field(default_factory=list)
    confidence: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class RunEventResponse(BaseModel):
    sequence: int
    event_type: str
    payload: dict[str, Any]
    created_at: datetime


class RunResponse(BaseModel):
    id: str
    project_id: str
    run_type: str
    task: str
    requested_agent: Optional[str] = None
    status: str
    context: dict[str, Any] = Field(default_factory=dict)
    final_output: Optional[str] = None
    error: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    started_at: datetime
    completed_at: Optional[datetime] = None
    events: list[RunEventResponse] = Field(default_factory=list)


class BibleUpdate(BaseModel):
    value: dict[str, Any] = Field(default_factory=dict)


class PromptTemplateCreate(BaseModel):
    project_id: Optional[str] = None
    name: str
    category: str = "general"
    target_kind: str = "general"
    description: str = ""
    system_prompt: str = ""
    user_prompt_template: str = ""
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class PromptTemplateUpdate(BaseModel):
    project_id: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    target_kind: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    tags: Optional[list[str]] = None
    metadata: Optional[dict[str, Any]] = None


class PromptTemplateFeedbackSummaryResponse(BaseModel):
    feedback_count: int = 0
    average_score: float = 0.0
    positive_feedback_count: int = 0
    negative_feedback_count: int = 0
    reuse_rate: Optional[float] = None
    common_strengths: list[str] = Field(default_factory=list)
    common_failures: list[str] = Field(default_factory=list)
    latest_feedback_at: Optional[datetime] = None


class PromptFeedbackCreate(BaseModel):
    project_id: Optional[str] = None
    run_id: Optional[str] = None
    feedback_source: str = "manual"
    score: int = Field(default=3, ge=1, le=5)
    would_reuse: Optional[bool] = None
    use_case: str = ""
    strengths: list[str] = Field(default_factory=list)
    failure_modes: list[str] = Field(default_factory=list)
    notes: str = ""
    task_input: str = ""
    output_excerpt: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class PromptFeedbackResponse(BaseModel):
    id: str
    prompt_template_id: str
    project_id: Optional[str] = None
    run_id: Optional[str] = None
    feedback_source: str = "manual"
    score: int
    would_reuse: Optional[bool] = None
    use_case: str = ""
    strengths: list[str] = Field(default_factory=list)
    failure_modes: list[str] = Field(default_factory=list)
    notes: str = ""
    task_input: str = ""
    output_excerpt: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    system_prompt_snapshot: str = ""
    user_prompt_template_snapshot: str = ""
    created_at: datetime


class PromptFeedbackListResponse(BaseModel):
    template_id: str
    summary: Optional[PromptTemplateFeedbackSummaryResponse] = None
    feedback: list[PromptFeedbackResponse] = Field(default_factory=list)


class PromptOptimizationRequest(BaseModel):
    project_id: Optional[str] = None
    goal: str = ""
    create_variant: bool = False
    variant_name: str = ""


class PromptOptimizationResponse(BaseModel):
    template_id: str
    optimized_name: str
    system_prompt: str
    user_prompt_template: str
    rationale: str = ""
    changes: list[str] = Field(default_factory=list)
    metadata_updates: dict[str, Any] = Field(default_factory=dict)
    feedback_summary: Optional[PromptTemplateFeedbackSummaryResponse] = None
    created_prompt: Optional["PromptTemplateResponse"] = None


class PromptTemplateResponse(BaseModel):
    id: str
    project_id: Optional[str] = None
    name: str
    slug: str
    category: str
    target_kind: str
    description: str
    system_prompt: str
    user_prompt_template: str
    tags: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    is_builtin: bool = False
    feedback_summary: Optional[PromptTemplateFeedbackSummaryResponse] = None
    created_at: datetime
    updated_at: datetime


class PromptTemplateListResponse(BaseModel):
    prompts: list[PromptTemplateResponse] = Field(default_factory=list)


PromptOptimizationResponse.model_rebuild()


class BrandAutocompleteRequest(BaseModel):
    field: Literal[
        "brand_name",
        "voice_tone",
        "style_guide",
        "audience_personas",
        "off_brand_examples",
        "published_content_index",
        "all",
    ] = "all"
    prompt_template_id: Optional[str] = None
    guidance: str = ""
    brand_bible: dict[str, Any] = Field(default_factory=dict)


class BrandAutocompleteResponse(BaseModel):
    project_id: str
    field: str
    prompt_template_id: str
    prompt_template_name: str
    suggestions: dict[str, Any] = Field(default_factory=dict)
    rationale: str = ""
    context_documents: list[str] = Field(default_factory=list)


class MemoryUpdateRequest(BaseModel):
    summary: str = ""
    pinned_facts: list[str] = Field(default_factory=list)


class MemoryAutocompleteRequest(BaseModel):
    prompt_template_id: Optional[str] = None
    guidance: str = ""


class ProjectMemoryResponse(BaseModel):
    project_id: str
    summary: str = ""
    pinned_facts: list[str] = Field(default_factory=list)
    active_token_estimate: int = 0
    compaction_count: int = 0
    last_compacted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class WorkspaceMemoryResponse(BaseModel):
    id: str
    summary: str = ""
    pinned_facts: list[str] = Field(default_factory=list)
    active_token_estimate: int = 0
    compaction_count: int = 0
    last_compacted_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class MemoryArchiveSearchResultResponse(BaseModel):
    content: str
    score: float
    metadata: dict[str, Any] = Field(default_factory=dict)


class MemoryArchiveSearchResponse(BaseModel):
    scope: Literal["workspace", "project"]
    project_id: Optional[str] = None
    query: str
    results: list[MemoryArchiveSearchResultResponse] = Field(default_factory=list)


class MemoryAutocompleteResponse(BaseModel):
    scope: Literal["workspace", "project"]
    project_id: Optional[str] = None
    prompt_template_id: str
    prompt_template_name: str
    summary: str = ""
    pinned_facts: list[str] = Field(default_factory=list)
    rationale: str = ""
    context_sources: list[str] = Field(default_factory=list)


class OllamaBootstrapRequest(BaseModel):
    model: Optional[str] = None


class OllamaBootstrapStatusResponse(BaseModel):
    state: Literal["idle", "running", "succeeded", "failed"] = "idle"
    base_url: str
    model: str
    connected: bool = False
    available_models: list[str] = Field(default_factory=list)
    target_model_available: bool = False
    message: str = ""
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    log: list[str] = Field(default_factory=list)


class PipelineRunRequest(BaseModel):
    task: str
    pipeline_kind: Optional[str] = None
    context: dict[str, Any] = Field(default_factory=dict)


class PipelineBuilderStepRequest(BaseModel):
    workforce: str
    agent_id: str
    description: Optional[str] = None
    artifact_type: Optional[str] = None
    requires_artifacts: list[str] = Field(default_factory=list)
    is_gate: bool = False
    gate_input_artifact: Optional[str] = None


class PipelineBuilderRunRequest(BaseModel):
    task: str
    steps: list[PipelineBuilderStepRequest] = Field(default_factory=list, min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)


class PipelineRunResponse(BaseModel):
    run: RunResponse
    plan: dict[str, Any]
    final_output: str
    success: bool
    errors: list[str] = Field(default_factory=list)
    results: list[dict[str, Any]] = Field(default_factory=list)


class ProjectAgentRunResponse(BaseModel):
    run: RunResponse
    response: AgentInvocationResponse
    artifact: Optional[ArtifactResponse] = None


class WorkflowCommandRequest(BaseModel):
    command: str
    scope: Literal["workspace", "media", "general"] = "general"
    document_ids: list[str] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)
    execute: bool = True


class WorkflowCommandPlanStepResponse(BaseModel):
    workforce: str
    agent_id: str
    description: str
    artifact_type: Optional[str] = None
    requires_artifacts: list[str] = Field(default_factory=list)
    is_gate: bool = False
    gate_input_artifact: Optional[str] = None


class WorkflowCommandPlanResponse(BaseModel):
    summary: str
    rationale: str
    execution_mode: Literal["agent", "pipeline", "pipeline_builder"]
    task: str
    pipeline_kind: Optional[str] = None
    workforce: Optional[str] = None
    agent_id: Optional[str] = None
    steps: list[WorkflowCommandPlanStepResponse] = Field(default_factory=list)
    context_focus: list[str] = Field(default_factory=list)
    referenced_document_ids: list[str] = Field(default_factory=list)
    referenced_artifact_ids: list[str] = Field(default_factory=list)


class WorkflowCommandExecutionResponse(BaseModel):
    mode: Literal["agent", "pipeline", "pipeline_builder"]
    run: RunResponse
    final_output: str
    agent_response: Optional[AgentInvocationResponse] = None
    artifact: Optional[ArtifactResponse] = None
    pipeline_success: Optional[bool] = None
    pipeline_errors: list[str] = Field(default_factory=list)
    pipeline_results: list[dict[str, Any]] = Field(default_factory=list)


class WorkflowCommandResponse(BaseModel):
    project_id: str
    command: str
    scope: Literal["workspace", "media", "general"]
    model: str
    plan: WorkflowCommandPlanResponse
    execution: Optional[WorkflowCommandExecutionResponse] = None


class ProjectChatMessageRequest(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ProjectChatRequest(BaseModel):
    message: str
    scope: Literal["workspace", "media", "general"] = "general"
    conversation: list[ProjectChatMessageRequest] = Field(default_factory=list)
    document_ids: list[str] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)
    include_project_media: bool = True
    execute: bool = True
    model_target: Literal["local", "openrouter"] = "local"
    external_model: str = ""


class MultimodalCacheStatusResponse(BaseModel):
    cached_vision_filenames: list[str] = Field(default_factory=list)
    generated_vision_filenames: list[str] = Field(default_factory=list)
    cached_transcript_filenames: list[str] = Field(default_factory=list)
    generated_transcript_filenames: list[str] = Field(default_factory=list)


class ProjectChatResponse(BaseModel):
    project_id: str
    scope: Literal["workspace", "media", "general"]
    message: str
    model_target: Literal["local", "openrouter"]
    model: str
    planner_model: str
    assistant_message: str
    vision_enabled: bool = False
    used_vision_filenames: list[str] = Field(default_factory=list)
    audio_transcription_enabled: bool = False
    used_transcript_filenames: list[str] = Field(default_factory=list)
    multimodal_cache: MultimodalCacheStatusResponse = Field(default_factory=MultimodalCacheStatusResponse)
    plan: WorkflowCommandPlanResponse
    execution: Optional[WorkflowCommandExecutionResponse] = None
    referenced_documents: list[ProjectDocumentResponse] = Field(default_factory=list)
    referenced_artifacts: list[ArtifactResponse] = Field(default_factory=list)


class RenderJobCreateRequest(BaseModel):
    job_type: Literal["storyboard", "infographic", "narration", "assemble_video"]
    title: str = ""
    document_id: Optional[str] = None
    artifact_id: Optional[str] = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class MediaJobCreateRequest(BaseModel):
    project_id: str
    job_type: Literal["storyboard", "infographic", "narration", "assemble_video"]
    title: str = ""
    document_id: Optional[str] = None
    artifact_id: Optional[str] = None
    parameters: dict[str, Any] = Field(default_factory=dict)


class RenderJobAssetResponse(BaseModel):
    id: int
    asset_role: str
    asset_kind: Literal["artifact", "document"]
    metadata: dict[str, Any] = Field(default_factory=dict)
    media_asset: Optional[MediaAssetResponse] = None
    artifact: Optional[ArtifactResponse] = None
    document: Optional[ProjectDocumentResponse] = None
    created_at: datetime


class RenderJobResponse(BaseModel):
    id: str
    project_id: str
    run_id: Optional[str] = None
    job_type: str
    title: str = ""
    status: str
    source_document_id: Optional[str] = None
    source_artifact_id: Optional[str] = None
    parameters: dict[str, Any] = Field(default_factory=dict)
    result: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    media_assets: list[MediaAssetResponse] = Field(default_factory=list)
    assets: list[RenderJobAssetResponse] = Field(default_factory=list)
    run: Optional[RunResponse] = None


class RenderJobListResponse(BaseModel):
    jobs: list[RenderJobResponse] = Field(default_factory=list)


class MediaAssetListResponse(BaseModel):
    assets: list[MediaAssetResponse] = Field(default_factory=list)
