from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


class WorkspaceMemory(BaseModel):
    workspace_id: str = "global"
    summary: str = ""
    pinned_facts: list[str] = Field(default_factory=list)
    active_token_estimate: int = 0
    compaction_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class ProjectMemory(BaseModel):
    project_id: str
    project_name: str = ""
    description: str = ""
    domains: list[str] = Field(default_factory=list)
    story_bible: dict[str, Any] = Field(default_factory=dict)
    brand_bible: dict[str, Any] = Field(default_factory=dict)
    summary: str = ""
    pinned_facts: list[str] = Field(default_factory=list)
    active_token_estimate: int = 0
    compaction_count: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class AgentRequest(BaseModel):
    session_id: str
    user_input: str
    context: dict[str, Any] = Field(default_factory=dict)
    project_memory: Optional[ProjectMemory] = None
    workspace_memory: Optional[WorkspaceMemory] = None
    model: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    turboquant_kv_compression_enabled: bool = False


class AgentResponse(BaseModel):
    agent_name: str
    content: str
    artifact_type: Optional[str] = None
    action_items: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.9, ge=0.0, le=1.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaskClassification(BaseModel):
    scope: str
    risk: str
    novelty: str
    governance_class: str
    integration_level: str
    failure_cost: str
    reasoning: str


class GovernanceSpec(BaseModel):
    require_red_team: bool
    min_independent_model_opinions: int
    require_council_for: list[str]
    director_escalation_rules: list[str]
    confidence_thresholds: dict[str, float]
    approval_required_artifacts: list[str]
    audit_requirements: list[str]


class AgentAssignmentPlan(BaseModel):
    task_summary: str
    task_classification: TaskClassification
    required_agents: list[str]
    optional_agents: list[str]
    suppressed_agents: list[str]
    lead_agent: str
    execution_order: list[str]
    review_chain: list[str]
    council_required: bool
    director_required: bool
    expected_artifacts: list[str]
    selection_rationale: str


class CouncilDecision(BaseModel):
    decision_id: str
    topic: str
    options_considered: list[str]
    areas_of_agreement: list[str]
    areas_of_disagreement: list[str]
    recommended_option: str
    residual_risks: list[str]
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    escalated: bool = False


class EscalationRecord(BaseModel):
    trigger: str
    source_stage: str
    summary: str
    decision_required: str
    director_response: Optional[str] = None


class ArtifactRecord(BaseModel):
    artifact_type: str
    content: str
    version: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    linked_run_id: str


class RunEvent(BaseModel):
    sequence: int
    event_type: str
    payload: dict[str, Any]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
