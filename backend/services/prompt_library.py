from __future__ import annotations

import re
from typing import Any, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from database_models import PromptTemplateRecord
from services.prompt_feedback import summarize_prompt_feedback


def slugify_prompt_name(value: str) -> str:
    lowered = value.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
    return slug or "prompt-template"


DEFAULT_PROMPT_TEMPLATES: list[dict[str, Any]] = [
    {
        "slug": "educational-accuracy-policy-strict",
        "name": "Educational Accuracy Policy",
        "category": "analysis_policy",
        "target_kind": "general",
        "description": "GrantOS-style strict evidence policy for educational scripts, articles, and reviews.",
        "system_prompt": (
            "You enforce strict educational accuracy. Separate established evidence from hypothesis, avoid overclaiming, "
            "refuse unsupported mechanistic leaps, and clearly surface uncertainty when the evidence base is incomplete."
        ),
        "user_prompt_template": (
            "Apply this policy to the following content.\n\n"
            "Task context:\n{{guidance}}\n\n"
            "Content under review:\n{{document_context}}\n"
        ),
        "tags": ["accuracy", "education", "review", "evidence"],
        "metadata": {"focus": "educational_accuracy"},
        "is_builtin": True,
    },
    {
        "slug": "brand-autocomplete-default",
        "name": "Brand Autocomplete Default",
        "category": "brand_autocomplete",
        "target_kind": "brand_bible",
        "description": "General-purpose AI completion for brand bible fields using project documents and existing brand context.",
        "system_prompt": (
            "You are a senior brand strategist for StudioOS. Expand brand guidance with concrete, reusable, "
            "channel-aware details. Preserve what is already true in the project and avoid inventing facts that "
            "conflict with existing documents."
        ),
        "user_prompt_template": (
            "Project: {{project_name}}\n"
            "Description: {{project_description}}\n"
            "Domains: {{project_domains}}\n"
            "Requested field: {{requested_field}}\n"
            "Extra guidance: {{guidance}}\n\n"
            "Current brand bible:\n{{brand_bible_json}}\n\n"
            "Story bible:\n{{story_bible_json}}\n\n"
            "Relevant project document excerpts:\n{{document_context}}\n"
        ),
        "tags": ["brand", "autocomplete", "default"],
        "metadata": {"audience": "all"},
        "is_builtin": True,
    },
    {
        "slug": "brand-style-guide-expander",
        "name": "Brand Style Guide Expander",
        "category": "brand_autocomplete",
        "target_kind": "brand_bible",
        "description": "Focused prompt for enriching a style guide with formatting, tone, channel, and publishing rules.",
        "system_prompt": (
            "You specialize in operational brand style guides. Produce compact but specific rules that a writing or "
            "media team could apply repeatedly across a site, YouTube channel, and promo assets."
        ),
        "user_prompt_template": (
            "Expand the style system for this project.\n"
            "Project: {{project_name}}\n"
            "Description: {{project_description}}\n"
            "Current style guide:\n{{brand_bible_json}}\n\n"
            "Relevant project document excerpts:\n{{document_context}}\n"
        ),
        "tags": ["brand", "style-guide"],
        "metadata": {"focus": "style_guide"},
        "is_builtin": True,
    },
    {
        "slug": "brand-persona-builder",
        "name": "Brand Persona Builder",
        "category": "brand_autocomplete",
        "target_kind": "brand_bible",
        "description": "Focused prompt for audience personas and audience-specific content preferences.",
        "system_prompt": (
            "You are building realistic audience personas for editorial and media planning. Prioritize distinct "
            "motivations, knowledge levels, and content preferences that would help a production team make decisions."
        ),
        "user_prompt_template": (
            "Project: {{project_name}}\n"
            "Requested field: {{requested_field}}\n"
            "Extra guidance: {{guidance}}\n\n"
            "Current brand bible:\n{{brand_bible_json}}\n\n"
            "Relevant project document excerpts:\n{{document_context}}\n"
        ),
        "tags": ["brand", "audience", "personas"],
        "metadata": {"focus": "audience_personas"},
        "is_builtin": True,
    },
    {
        "slug": "project-memory-autocomplete-default",
        "name": "Project Memory Autocomplete Default",
        "category": "project_memory_autocomplete",
        "target_kind": "project_memory",
        "description": "Summarize stable project-specific memory from project docs, recent runs, and existing bibles.",
        "system_prompt": (
            "You are maintaining reusable project memory for StudioOS. Capture stable facts that help automate "
            "repeat work across drafts, uploads, editing passes, and publishing steps. Do not duplicate transient "
            "run chatter or invent unsupported facts."
        ),
        "user_prompt_template": (
            "Project: {{project_name}}\n"
            "Description: {{project_description}}\n"
            "Domains: {{project_domains}}\n"
            "Extra guidance: {{guidance}}\n\n"
            "Workspace memory:\n{{workspace_memory_json}}\n\n"
            "Current project memory:\n{{project_memory_json}}\n\n"
            "Story bible:\n{{story_bible_json}}\n\n"
            "Brand bible:\n{{brand_bible_json}}\n\n"
            "Relevant project documents:\n{{document_context}}\n\n"
            "Recent runs:\n{{recent_runs}}\n\n"
            "Recent artifacts:\n{{recent_artifacts}}\n"
        ),
        "tags": ["memory", "project", "automation"],
        "metadata": {"scope": "project"},
        "is_builtin": True,
    },
    {
        "slug": "workspace-memory-autocomplete-default",
        "name": "Workspace Memory Autocomplete Default",
        "category": "workspace_memory_autocomplete",
        "target_kind": "workspace_memory",
        "description": "Summarize reusable cross-project operating memory from the whole suite.",
        "system_prompt": (
            "You are maintaining StudioOS workspace memory shared across projects. Capture reusable operating "
            "preferences, recurring workflows, automation rules, naming conventions, and constraints that should "
            "apply broadly. Avoid project-specific details unless they generalize."
        ),
        "user_prompt_template": (
            "Extra guidance: {{guidance}}\n\n"
            "Current workspace memory:\n{{workspace_memory_json}}\n\n"
            "Active projects:\n{{projects_json}}\n\n"
            "Recent runs across the suite:\n{{recent_runs}}\n\n"
            "Recent artifacts across the suite:\n{{recent_artifacts}}\n"
        ),
        "tags": ["memory", "workspace", "automation"],
        "metadata": {"scope": "workspace"},
        "is_builtin": True,
    },
]


def ensure_default_prompt_templates(db: Session) -> int:
    inserted = 0
    for template in DEFAULT_PROMPT_TEMPLATES:
        existing = db.query(PromptTemplateRecord).filter(PromptTemplateRecord.slug == template["slug"]).first()
        if existing:
            continue
        db.add(
            PromptTemplateRecord(
                project_id=None,
                name=template["name"],
                slug=template["slug"],
                category=template["category"],
                target_kind=template["target_kind"],
                description=template["description"],
                system_prompt=template["system_prompt"],
                user_prompt_template=template["user_prompt_template"],
                tags=list(template.get("tags", [])),
                metadata_=dict(template.get("metadata", {})),
                is_builtin=bool(template.get("is_builtin", False)),
            )
        )
        inserted += 1

    if inserted:
        db.commit()
    return inserted


def list_prompt_templates(
    db: Session,
    *,
    category: Optional[str] = None,
    project_id: Optional[str] = None,
) -> list[PromptTemplateRecord]:
    query = db.query(PromptTemplateRecord)
    if category:
        query = query.filter(PromptTemplateRecord.category == category)
    if project_id:
        query = query.filter(or_(PromptTemplateRecord.project_id.is_(None), PromptTemplateRecord.project_id == project_id))
    return (
        query.order_by(
            PromptTemplateRecord.project_id.isnot(None).desc(),
            PromptTemplateRecord.updated_at.desc(),
            PromptTemplateRecord.name.asc(),
        ).all()
    )


def get_prompt_template(
    db: Session,
    template_id: str,
    *,
    project_id: Optional[str] = None,
) -> PromptTemplateRecord | None:
    query = db.query(PromptTemplateRecord).filter(PromptTemplateRecord.id == template_id)
    if project_id:
        query = query.filter(or_(PromptTemplateRecord.project_id == None, PromptTemplateRecord.project_id == project_id))
    return query.first()


def select_preferred_prompt_template(
    db: Session,
    *,
    category: str,
    target_kind: Optional[str] = None,
    project_id: Optional[str] = None,
    focus: Optional[str] = None,
    fallback_slug: Optional[str] = None,
) -> PromptTemplateRecord | None:
    query = db.query(PromptTemplateRecord).filter(PromptTemplateRecord.category == category)
    if target_kind:
        query = query.filter(PromptTemplateRecord.target_kind == target_kind)
    if project_id:
        query = query.filter(or_(PromptTemplateRecord.project_id.is_(None), PromptTemplateRecord.project_id == project_id))
    else:
        query = query.filter(PromptTemplateRecord.project_id.is_(None))

    candidates = query.all()
    if not candidates and fallback_slug:
        return db.query(PromptTemplateRecord).filter(PromptTemplateRecord.slug == fallback_slug).first()
    if not candidates:
        return None

    normalized_focus = (focus or "").strip().lower()

    def focus_value(template: PromptTemplateRecord) -> str:
        metadata = template.metadata_ or {}
        return str(metadata.get("focus") or "").strip().lower()

    def ranking_key(template: PromptTemplateRecord) -> tuple[Any, ...]:
        summary = summarize_prompt_feedback(list(template.feedback_records or [])) or {}
        template_focus = focus_value(template)
        feedback_count = int(summary.get("feedback_count", 0) or 0)
        average_score = float(summary.get("average_score", 0.0) or 0.0)
        reuse_rate = float(summary.get("reuse_rate", -1.0) if summary.get("reuse_rate") is not None else -1.0)
        negative_feedback_count = int(summary.get("negative_feedback_count", 0) or 0)
        updated = template.updated_at or template.created_at
        updated_timestamp = updated.timestamp() if updated is not None else 0.0

        if normalized_focus and normalized_focus != "all":
            focus_rank = 2 if template_focus == normalized_focus else 1 if not template_focus else 0
        else:
            focus_rank = 1 if not template_focus else 0

        return (
            1 if project_id and template.project_id == project_id else 0,
            focus_rank,
            1 if feedback_count > 0 else 0,
            average_score,
            reuse_rate,
            feedback_count,
            -negative_feedback_count,
            1 if not template.is_builtin else 0,
            updated_timestamp,
        )

    ranked = sorted(candidates, key=ranking_key, reverse=True)
    return ranked[0]


def serialize_prompt_template(template: PromptTemplateRecord) -> dict[str, Any]:
    return {
        "id": template.id,
        "project_id": template.project_id,
        "name": template.name,
        "slug": template.slug,
        "category": template.category,
        "target_kind": template.target_kind,
        "description": template.description,
        "system_prompt": template.system_prompt,
        "user_prompt_template": template.user_prompt_template,
        "tags": list(template.tags or []),
        "metadata": template.metadata_ or {},
        "is_builtin": template.is_builtin,
        "feedback_summary": summarize_prompt_feedback(list(template.feedback_records or [])),
        "created_at": template.created_at,
        "updated_at": template.updated_at,
    }
