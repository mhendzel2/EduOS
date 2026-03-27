from __future__ import annotations

import json
import re
from collections import Counter
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from database_models import PromptFeedbackRecord, PromptTemplateRecord
from models.model_client import chat_completion, extract_text, get_local_workflow_model


def _normalized_list(values: list[str] | None) -> list[str]:
    return [str(value).strip() for value in values or [] if str(value).strip()]


def serialize_prompt_feedback(record: PromptFeedbackRecord) -> dict[str, Any]:
    return {
        "id": record.id,
        "prompt_template_id": record.prompt_template_id,
        "project_id": record.project_id,
        "run_id": record.run_id,
        "feedback_source": record.feedback_source,
        "score": record.score,
        "would_reuse": record.would_reuse,
        "use_case": record.use_case,
        "strengths": list(record.strengths or []),
        "failure_modes": list(record.failure_modes or []),
        "notes": record.notes,
        "task_input": record.task_input,
        "output_excerpt": record.output_excerpt,
        "metadata": record.metadata_ or {},
        "system_prompt_snapshot": record.system_prompt_snapshot,
        "user_prompt_template_snapshot": record.user_prompt_template_snapshot,
        "created_at": record.created_at,
    }


def summarize_prompt_feedback(records: list[PromptFeedbackRecord]) -> dict[str, Any] | None:
    if not records:
        return None

    total_score = sum(record.score for record in records)
    reuse_votes = [record.would_reuse for record in records if record.would_reuse is not None]
    strengths = Counter(item for record in records for item in _normalized_list(list(record.strengths or [])))
    failure_modes = Counter(item for record in records for item in _normalized_list(list(record.failure_modes or [])))

    return {
        "feedback_count": len(records),
        "average_score": round(total_score / len(records), 2),
        "positive_feedback_count": sum(1 for record in records if record.score >= 4),
        "negative_feedback_count": sum(1 for record in records if record.score <= 2),
        "reuse_rate": round(sum(1 for vote in reuse_votes if vote) / len(reuse_votes), 2) if reuse_votes else None,
        "common_strengths": [item for item, _count in strengths.most_common(5)],
        "common_failures": [item for item, _count in failure_modes.most_common(5)],
        "latest_feedback_at": records[0].created_at.isoformat() if records[0].created_at else None,
    }


def create_prompt_feedback(
    db: Session,
    template: PromptTemplateRecord,
    *,
    project_id: str | None = None,
    run_id: str | None = None,
    feedback_source: str = "manual",
    score: int,
    would_reuse: bool | None,
    use_case: str = "",
    strengths: list[str] | None = None,
    failure_modes: list[str] | None = None,
    notes: str = "",
    task_input: str = "",
    output_excerpt: str = "",
    metadata: dict[str, Any] | None = None,
) -> PromptFeedbackRecord:
    feedback = PromptFeedbackRecord(
        prompt_template_id=template.id,
        project_id=project_id,
        run_id=run_id,
        feedback_source=feedback_source.strip() or "manual",
        score=score,
        would_reuse=would_reuse,
        use_case=use_case.strip(),
        strengths=_normalized_list(strengths),
        failure_modes=_normalized_list(failure_modes),
        notes=notes.strip(),
        task_input=task_input.strip(),
        output_excerpt=output_excerpt.strip(),
        metadata_=dict(metadata or {}),
        system_prompt_snapshot=template.system_prompt,
        user_prompt_template_snapshot=template.user_prompt_template,
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)
    return feedback


def list_prompt_feedback_records(
    db: Session,
    template_id: str,
    *,
    limit: int = 20,
) -> list[PromptFeedbackRecord]:
    bounded_limit = max(1, min(limit, 100))
    return (
        db.query(PromptFeedbackRecord)
        .filter(PromptFeedbackRecord.prompt_template_id == template_id)
        .order_by(PromptFeedbackRecord.created_at.desc())
        .limit(bounded_limit)
        .all()
    )


class _PromptOptimizationResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    optimized_name: str = ""
    system_prompt: str
    user_prompt_template: str
    rationale: str = ""
    changes: list[str] = Field(default_factory=list)
    metadata_updates: dict[str, Any] = Field(default_factory=dict)


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    cleaned = (raw_text or "").strip()
    if not cleaned:
        raise ValueError("Empty response from prompt optimizer.")

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise ValueError("Prompt optimizer did not return JSON.")
    parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise ValueError("Prompt optimizer returned non-object JSON.")
    return parsed


def _extract_placeholders(template: PromptTemplateRecord) -> list[str]:
    pattern = re.compile(r"\{\{[^{}]+\}\}")
    values = set(pattern.findall(template.system_prompt or ""))
    values.update(pattern.findall(template.user_prompt_template or ""))
    return sorted(values)


def _truncate(value: str, *, limit: int = 1200) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def _json_excerpt(value: Any, *, limit: int = 700) -> str:
    try:
        rendered = json.dumps(value, indent=2, ensure_ascii=True, default=str)
    except Exception:
        rendered = str(value)
    return _truncate(rendered, limit=limit)


def _automatic_brand_feedback(
    result_payload: dict[str, Any],
    *,
    requested_field: str,
) -> dict[str, Any]:
    suggestions = result_payload.get("suggestions") if isinstance(result_payload.get("suggestions"), dict) else {}
    rationale = str(result_payload.get("rationale") or "").strip()
    context_documents = [str(item).strip() for item in result_payload.get("context_documents") or [] if str(item).strip()]

    filled_keys = [
        key
        for key, value in suggestions.items()
        if value not in (None, "", [], {})
    ]

    strengths: list[str] = []
    failure_modes: list[str] = []
    score = 2

    if requested_field == "all":
        if len(filled_keys) >= 2:
            score += 1
            strengths.append("multi_field_structured_output")
        else:
            failure_modes.append("limited_field_coverage")
    elif requested_field in filled_keys:
        score += 1
        strengths.append("requested_field_filled")
    else:
        failure_modes.append("requested_field_missing")

    if rationale:
        score += 1
        strengths.append("returned_rationale")

    if context_documents:
        score += 1
        strengths.append("used_project_context")

    if len(filled_keys) >= 3:
        score += 1
        strengths.append("rich_structured_output")

    final_score = max(1, min(5, score))
    return {
        "score": final_score,
        "would_reuse": final_score >= 4,
        "strengths": strengths,
        "failure_modes": failure_modes,
        "notes": (
            f"Automatic runtime feedback: brand autocomplete returned {len(filled_keys)} populated field(s)"
            f" for request '{requested_field}'."
        ),
        "output_excerpt": _json_excerpt(suggestions),
        "metadata": {
            "requested_field": requested_field,
            "populated_fields": filled_keys,
            "context_documents_count": len(context_documents),
        },
    }


def _automatic_memory_feedback(
    result_payload: dict[str, Any],
    *,
    scope: str,
) -> dict[str, Any]:
    summary = str(result_payload.get("summary") or "").strip()
    pinned_facts = _normalized_list(list(result_payload.get("pinned_facts") or []))
    rationale = str(result_payload.get("rationale") or "").strip()
    context_sources = [str(item).strip() for item in result_payload.get("context_sources") or [] if str(item).strip()]

    strengths: list[str] = []
    failure_modes: list[str] = []
    score = 1

    if summary:
        score += 1
        strengths.append("returned_summary")
    else:
        failure_modes.append("missing_summary")

    if pinned_facts:
        score += 1
        strengths.append("returned_pinned_facts")
    else:
        failure_modes.append("missing_pinned_facts")

    if rationale:
        score += 1
        strengths.append("returned_rationale")

    if len(pinned_facts) >= 2 or len(summary) >= 120:
        score += 1
        strengths.append("useful_detail_level")

    final_score = max(1, min(5, score))
    return {
        "score": final_score,
        "would_reuse": final_score >= 4,
        "strengths": strengths,
        "failure_modes": failure_modes,
        "notes": (
            f"Automatic runtime feedback: {scope} memory autocomplete returned "
            f"{len(pinned_facts)} pinned fact(s)."
        ),
        "output_excerpt": _json_excerpt({"summary": summary, "pinned_facts": pinned_facts}),
        "metadata": {
            "scope": scope,
            "summary_length": len(summary),
            "pinned_fact_count": len(pinned_facts),
            "context_source_count": len(context_sources),
        },
    }


def capture_automatic_prompt_feedback(
    db: Session,
    template: PromptTemplateRecord,
    *,
    project_id: str | None = None,
    run_id: str | None = None,
    use_case: str,
    task_input: str = "",
    result_payload: dict[str, Any] | None = None,
    error_message: str = "",
    metadata: dict[str, Any] | None = None,
) -> PromptFeedbackRecord | None:
    try:
        base_metadata = dict(metadata or {})
        base_metadata["automatic"] = True

        if error_message.strip():
            error_kind = str(base_metadata.get("error_kind") or "runtime_error").strip() or "runtime_error"
            failure_modes = [error_kind]
            return create_prompt_feedback(
                db,
                template,
                project_id=project_id,
                run_id=run_id,
                feedback_source="auto_runtime",
                score=1,
                would_reuse=False,
                use_case=use_case,
                strengths=[],
                failure_modes=failure_modes,
                notes=f"Automatic runtime feedback: {use_case} failed with {error_kind}.",
                task_input=task_input,
                output_excerpt=_truncate(error_message, limit=500),
                metadata={**base_metadata, "success": False},
            )

        payload = dict(result_payload or {})
        if use_case == "brand_autocomplete":
            automatic = _automatic_brand_feedback(
                payload,
                requested_field=str(base_metadata.get("requested_field") or "all"),
            )
        elif use_case == "project_memory_autocomplete":
            automatic = _automatic_memory_feedback(payload, scope="project")
        elif use_case == "workspace_memory_autocomplete":
            automatic = _automatic_memory_feedback(payload, scope="workspace")
        else:
            automatic = {
                "score": 3,
                "would_reuse": None,
                "strengths": ["completed_successfully"],
                "failure_modes": [],
                "notes": f"Automatic runtime feedback: {use_case} completed successfully.",
                "output_excerpt": _json_excerpt(payload),
                "metadata": {},
            }

        return create_prompt_feedback(
            db,
            template,
            project_id=project_id,
            run_id=run_id,
            feedback_source="auto_runtime",
            score=int(automatic["score"]),
            would_reuse=automatic.get("would_reuse"),
            use_case=use_case,
            strengths=list(automatic.get("strengths") or []),
            failure_modes=list(automatic.get("failure_modes") or []),
            notes=str(automatic.get("notes") or ""),
            task_input=task_input,
            output_excerpt=str(automatic.get("output_excerpt") or ""),
            metadata={**base_metadata, **dict(automatic.get("metadata") or {}), "success": True},
        )
    except Exception:
        db.rollback()
        return None


def _heuristic_prompt_optimization(
    template: PromptTemplateRecord,
    *,
    goal: str,
    summary: dict[str, Any] | None,
    records: list[PromptFeedbackRecord],
) -> dict[str, Any]:
    strengths = summary.get("common_strengths", []) if summary else []
    failures = summary.get("common_failures", []) if summary else []
    recent_notes = [record.notes.strip() for record in records if record.notes.strip()][:3]

    additions: list[str] = []
    if strengths:
        additions.append(f"Preserve these strengths: {', '.join(strengths)}.")
    if failures:
        additions.append(f"Avoid these failure modes: {', '.join(failures)}.")
    if goal.strip():
        additions.append(f"Optimization goal: {goal.strip()}.")
    if recent_notes:
        additions.append(f"Recent operator feedback: {' | '.join(recent_notes)}")

    system_prompt = template.system_prompt.strip()
    if additions:
        system_prompt = f"{system_prompt}\n\nPrompt optimization guidance:\n- " + "\n- ".join(additions)

    changes = []
    if strengths or failures or goal.strip():
        changes.append("Added explicit feedback guidance to the system prompt to preserve strengths and reduce recurring failures.")

    return {
        "optimized_name": f"{template.name} Optimized",
        "system_prompt": system_prompt,
        "user_prompt_template": template.user_prompt_template,
        "rationale": "Generated a heuristic optimization because a structured local-model suggestion was unavailable.",
        "changes": changes,
        "metadata_updates": {
            "feedback_count": summary.get("feedback_count", 0) if summary else 0,
            "heuristic": True,
        },
    }


async def generate_prompt_optimization(
    template: PromptTemplateRecord,
    *,
    feedback_records: list[PromptFeedbackRecord],
    goal: str = "",
) -> dict[str, Any]:
    summary = summarize_prompt_feedback(feedback_records)
    placeholders = _extract_placeholders(template)

    feedback_payload = [
        {
            "score": record.score,
            "would_reuse": record.would_reuse,
            "use_case": record.use_case,
            "strengths": list(record.strengths or []),
            "failure_modes": list(record.failure_modes or []),
            "notes": _truncate(record.notes),
            "task_input": _truncate(record.task_input, limit=500),
            "output_excerpt": _truncate(record.output_excerpt, limit=500),
            "created_at": record.created_at.isoformat(),
        }
        for record in feedback_records[:8]
    ]

    system_message = (
        "You improve StudioOS prompt templates using operator feedback. Preserve working behavior, keep template "
        "variables stable unless a clear change is justified, and return exactly one JSON object."
    )
    user_message = (
        "Optimize this prompt template using local feedback.\n\n"
        f"Prompt name: {template.name}\n"
        f"Category: {template.category}\n"
        f"Target kind: {template.target_kind}\n"
        f"Description: {template.description}\n"
        f"Allowed template placeholders: {json.dumps(placeholders)}\n"
        f"Optimization goal: {goal.strip() or 'Improve quality, consistency, and format adherence while preserving intent.'}\n\n"
        f"Current system prompt:\n{template.system_prompt}\n\n"
        f"Current user prompt template:\n{template.user_prompt_template}\n\n"
        f"Feedback summary:\n{json.dumps(summary or {}, indent=2, ensure_ascii=True)}\n\n"
        f"Recent feedback records:\n{json.dumps(feedback_payload, indent=2, ensure_ascii=True)}\n\n"
        "Return JSON with this exact shape:\n"
        "{\n"
        '  "optimized_name": "string",\n'
        '  "system_prompt": "string",\n'
        '  "user_prompt_template": "string",\n'
        '  "rationale": "string",\n'
        '  "changes": ["string"],\n'
        '  "metadata_updates": {"key": "value"}\n'
        "}\n"
        "Keep placeholders compatible with the current template unless explicitly justified in changes."
    )

    try:
        response = await chat_completion(
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message},
            ],
            model=get_local_workflow_model(),
            temperature=0.2,
            max_tokens=2800,
        )
        parsed = _PromptOptimizationResponse.model_validate(_extract_json_object(extract_text(response)))
        return parsed.model_dump()
    except Exception:
        return _heuristic_prompt_optimization(template, goal=goal, summary=summary, records=feedback_records)
