"""Model Catalog Service for StudioOS.

Fetches the latest OpenRouter model directory and caches it in the local DB so
the routing UI can expose current model ids and pricing without hard-coding a
stale list into the repository.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from database import SessionLocal
from database_models import ModelCatalogRecord, utc_now

logger = logging.getLogger(__name__)

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
_VENDOR_ALLOWLIST = {
    "anthropic",
    "deepseek",
    "google",
    "meta-llama",
    "mistralai",
    "openai",
    "qwen",
    "x-ai",
}


def _extract_vendor(model_id: str) -> str:
    return model_id.split("/", 1)[0] if "/" in model_id else ""


def _parse_model(raw: Dict[str, Any]) -> Optional[ModelCatalogRecord]:
    model_id = str(raw.get("id") or "").strip()
    if not model_id:
        return None

    vendor = _extract_vendor(model_id)
    if vendor not in _VENDOR_ALLOWLIST:
        return None

    pricing = raw.get("pricing") or {}
    input_per_token = float(pricing.get("prompt", 0) or 0)
    output_per_token = float(pricing.get("completion", 0) or 0)

    architecture = raw.get("architecture") or {}
    input_modalities = architecture.get("input_modalities") or []
    if not input_modalities and isinstance(architecture.get("modality"), str):
        input_modalities = [architecture["modality"]]

    return ModelCatalogRecord(
        id=model_id,
        provider="openrouter",
        name=str(raw.get("name") or model_id)[:255],
        description=str(raw.get("description") or "")[:4000],
        context_length=int(
            raw.get("context_length")
            or (raw.get("top_provider") or {}).get("context_length")
            or 0
        ),
        input_cost_per_1k=round(input_per_token * 1000, 8),
        output_cost_per_1k=round(output_per_token * 1000, 8),
        supports_images=any("image" in str(modality).lower() for modality in input_modalities),
        supports_tool_use=False,
        is_free=(input_per_token == 0 and output_per_token == 0),
        top_provider=str((raw.get("top_provider") or {}).get("context_length") or ""),
        fetched_at=utc_now(),
    )


async def fetch_and_store_catalog() -> Dict[str, Any]:
    logger.info("Fetching latest OpenRouter model catalog")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(OPENROUTER_MODELS_URL)
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:
        logger.error("OpenRouter catalog fetch failed: %s", exc)
        return {"ok": False, "error": str(exc), "models_updated": 0}

    records: List[ModelCatalogRecord] = []
    for raw in payload.get("data", []) or []:
        parsed = _parse_model(raw)
        if parsed is not None:
            records.append(parsed)

    db: Session = SessionLocal()
    try:
        db.execute(delete(ModelCatalogRecord))
        db.add_all(records)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error("OpenRouter catalog persist failed: %s", exc)
        return {"ok": False, "error": str(exc), "models_updated": 0}
    finally:
        db.close()

    return {"ok": True, "models_updated": len(records)}


def get_catalog_models(db: Session) -> List[ModelCatalogRecord]:
    return list(db.execute(select(ModelCatalogRecord).order_by(ModelCatalogRecord.id)).scalars().all())


def get_catalog_costs(db: Session) -> Dict[str, tuple[float, float]]:
    rows = db.execute(
        select(
            ModelCatalogRecord.id,
            ModelCatalogRecord.input_cost_per_1k,
            ModelCatalogRecord.output_cost_per_1k,
        )
    ).all()
    return {f"openrouter/{row[0]}": (float(row[1]), float(row[2])) for row in rows}
