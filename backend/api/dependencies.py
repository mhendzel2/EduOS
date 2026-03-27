from __future__ import annotations

from functools import lru_cache

from coordinators.local import LocalCoordinator
from database import get_db
from models.router import ModelRouter, get_model_router as _get_model_router


@lru_cache(maxsize=1)
def get_coordinator() -> LocalCoordinator:
    return LocalCoordinator()


def get_model_router() -> ModelRouter:
    return _get_model_router()


__all__ = ["get_coordinator", "get_db", "get_model_router"]
