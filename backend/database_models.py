from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
import uuid

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ProjectRecord(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    domains: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    story_bible: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    brand_bible: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    documents: Mapped[list["DocumentRecord"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    runs: Mapped[list["RunRecord"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    artifacts: Mapped[list["ArtifactRecord"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="ArtifactRecord.created_at.desc()",
    )
    memory: Mapped[Optional["ProjectMemoryRecord"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        uselist=False,
    )
    media_tool_settings: Mapped[Optional["ProjectMediaToolSettingsRecord"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        uselist=False,
    )
    media_assets: Mapped[list["MediaAssetRecord"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="MediaAssetRecord.created_at.desc()",
    )
    render_jobs: Mapped[list["RenderJobRecord"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="RenderJobRecord.created_at.desc()",
    )


class DocumentRecord(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    path: Mapped[str] = mapped_column(Text, nullable=False)
    size: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), default="application/octet-stream", nullable=False)
    source_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_reference: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    project: Mapped["ProjectRecord"] = relationship(back_populates="documents")
    provenance: Mapped[Optional["DocumentProvenanceRecord"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        uselist=False,
    )
    media_assets: Mapped[list["MediaAssetRecord"]] = relationship(back_populates="document")
    render_job_assets: Mapped[list["RenderJobAssetRecord"]] = relationship(back_populates="document")


class PromptTemplateRecord(Base):
    __tablename__ = "prompt_templates"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[Optional[str]] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(200), index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(64), default="general", nullable=False)
    target_kind: Mapped[str] = mapped_column(String(64), default="general", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    user_prompt_template: Mapped[str] = mapped_column(Text, default="", nullable=False)
    tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
    feedback_records: Mapped[list["PromptFeedbackRecord"]] = relationship(
        back_populates="prompt_template",
        cascade="all, delete-orphan",
        order_by="PromptFeedbackRecord.created_at.desc()",
    )


class PromptFeedbackRecord(Base):
    __tablename__ = "prompt_feedback"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    prompt_template_id: Mapped[str] = mapped_column(
        ForeignKey("prompt_templates.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    project_id: Mapped[Optional[str]] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    run_id: Mapped[Optional[str]] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"), index=True)
    feedback_source: Mapped[str] = mapped_column(String(64), default="manual", nullable=False)
    score: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    would_reuse: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    use_case: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    strengths: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    failure_modes: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    task_input: Mapped[str] = mapped_column(Text, default="", nullable=False)
    output_excerpt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    system_prompt_snapshot: Mapped[str] = mapped_column(Text, default="", nullable=False)
    user_prompt_template_snapshot: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    prompt_template: Mapped["PromptTemplateRecord"] = relationship(back_populates="feedback_records")


class ModelCatalogRecord(Base):
    __tablename__ = "model_catalog"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    context_length: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    input_cost_per_1k: Mapped[float] = mapped_column(nullable=False, default=0.0)
    output_cost_per_1k: Mapped[float] = mapped_column(nullable=False, default=0.0)
    supports_images: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    supports_tool_use: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_free: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    top_provider: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class RunRecord(Base):
    __tablename__ = "runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    run_type: Mapped[str] = mapped_column(String(32), nullable=False)
    task: Mapped[str] = mapped_column(Text, nullable=False)
    requested_agent: Mapped[Optional[str]] = mapped_column(String(128))
    coordinator: Mapped[str] = mapped_column(String(64), default="local", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False)
    context: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    final_output: Mapped[Optional[str]] = mapped_column(Text)
    error: Mapped[Optional[str]] = mapped_column(Text)
    details: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    project: Mapped["ProjectRecord"] = relationship(back_populates="runs")
    events: Mapped[list["RunEventRecord"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="RunEventRecord.sequence",
    )
    artifacts: Mapped[list["ArtifactRecord"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ArtifactRecord.created_at.desc()",
    )
    media_assets: Mapped[list["MediaAssetRecord"]] = relationship(back_populates="run")
    render_jobs: Mapped[list["RenderJobRecord"]] = relationship(back_populates="run")


class RunEventRecord(Base):
    __tablename__ = "run_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(128), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    run: Mapped["RunRecord"] = relationship(back_populates="events")


class ArtifactRecord(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"), index=True)
    artifact_type: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[Optional[str]] = mapped_column(Text)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    project: Mapped["ProjectRecord"] = relationship(back_populates="artifacts")
    run: Mapped[Optional["RunRecord"]] = relationship(back_populates="artifacts")
    media_assets: Mapped[list["MediaAssetRecord"]] = relationship(back_populates="artifact")
    render_job_assets: Mapped[list["RenderJobAssetRecord"]] = relationship(back_populates="artifact")


class MediaAssetRecord(Base):
    __tablename__ = "media_assets"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"), index=True)
    render_job_id: Mapped[Optional[str]] = mapped_column(ForeignKey("render_jobs.id", ondelete="SET NULL"), index=True)
    document_id: Mapped[Optional[str]] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), index=True)
    artifact_id: Mapped[Optional[str]] = mapped_column(ForeignKey("artifacts.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    role: Mapped[str] = mapped_column(String(64), default="output", nullable=False)
    storage_uri: Mapped[str] = mapped_column(Text, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), default="application/octet-stream", nullable=False)
    license: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    created_by: Mapped[str] = mapped_column(String(128), default="", nullable=False)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    project: Mapped["ProjectRecord"] = relationship(back_populates="media_assets")
    run: Mapped[Optional["RunRecord"]] = relationship(back_populates="media_assets")
    render_job: Mapped[Optional["RenderJobRecord"]] = relationship(back_populates="media_assets")
    document: Mapped[Optional["DocumentRecord"]] = relationship(back_populates="media_assets")
    artifact: Mapped[Optional["ArtifactRecord"]] = relationship(back_populates="media_assets")
    render_job_assets: Mapped[list["RenderJobAssetRecord"]] = relationship(back_populates="media_asset")


class DocumentProvenanceRecord(Base):
    __tablename__ = "document_provenance"

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), primary_key=True)
    source_type: Mapped[str] = mapped_column(String(64), default="structured", nullable=False)
    source_identifier: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    source_url: Mapped[str] = mapped_column(Text, default="", nullable=False)
    citation: Mapped[str] = mapped_column(Text, default="", nullable=False)
    authors: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    published_at: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    document: Mapped["DocumentRecord"] = relationship(back_populates="provenance")


class WorkspaceMemoryRecord(Base):
    __tablename__ = "workspace_memory"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default="global")
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    pinned_facts: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    active_token_estimate: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    compaction_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_compacted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class ProjectMediaToolSettingsRecord(Base):
    __tablename__ = "project_media_tool_settings"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    tools: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    project: Mapped["ProjectRecord"] = relationship(back_populates="media_tool_settings")


class ProjectMemoryRecord(Base):
    __tablename__ = "project_memory"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    pinned_facts: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    active_token_estimate: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    compaction_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_compacted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
    project: Mapped["ProjectRecord"] = relationship(back_populates="memory")


class RenderJobRecord(Base):
    __tablename__ = "render_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    run_id: Mapped[Optional[str]] = mapped_column(ForeignKey("runs.id", ondelete="SET NULL"), index=True)
    job_type: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="queued", nullable=False)
    source_document_id: Mapped[Optional[str]] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), index=True)
    source_artifact_id: Mapped[Optional[str]] = mapped_column(ForeignKey("artifacts.id", ondelete="SET NULL"), index=True)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    result: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    project: Mapped["ProjectRecord"] = relationship(back_populates="render_jobs")
    run: Mapped[Optional["RunRecord"]] = relationship(back_populates="render_jobs")
    source_document: Mapped[Optional["DocumentRecord"]] = relationship(foreign_keys=[source_document_id])
    source_artifact: Mapped[Optional["ArtifactRecord"]] = relationship(foreign_keys=[source_artifact_id])
    media_assets: Mapped[list["MediaAssetRecord"]] = relationship(
        back_populates="render_job",
        order_by="MediaAssetRecord.created_at.asc()",
    )
    assets: Mapped[list["RenderJobAssetRecord"]] = relationship(
        back_populates="job",
        cascade="all, delete-orphan",
        order_by="RenderJobAssetRecord.created_at.asc()",
    )


class RenderJobAssetRecord(Base):
    __tablename__ = "render_job_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("render_jobs.id", ondelete="CASCADE"), index=True, nullable=False)
    asset_role: Mapped[str] = mapped_column(String(64), nullable=False)
    asset_kind: Mapped[str] = mapped_column(String(32), nullable=False)
    media_asset_id: Mapped[Optional[str]] = mapped_column(ForeignKey("media_assets.id", ondelete="SET NULL"), index=True)
    artifact_id: Mapped[Optional[str]] = mapped_column(ForeignKey("artifacts.id", ondelete="SET NULL"), index=True)
    document_id: Mapped[Optional[str]] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), index=True)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    job: Mapped["RenderJobRecord"] = relationship(back_populates="assets")
    media_asset: Mapped[Optional["MediaAssetRecord"]] = relationship(back_populates="render_job_assets")
    artifact: Mapped[Optional["ArtifactRecord"]] = relationship(back_populates="render_job_assets")
    document: Mapped[Optional["DocumentRecord"]] = relationship(back_populates="render_job_assets")
