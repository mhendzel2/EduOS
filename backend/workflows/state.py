from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class SharedState:
    task: str
    context: dict[str, Any] = field(default_factory=dict)
    artifacts: dict[str, str] = field(default_factory=dict)
    artifact_provenance: dict[str, str] = field(default_factory=dict)

    def update(self, artifact_type: str, content: str, provenance: str) -> None:
        if not content:
            return
        self.artifacts[artifact_type] = content
        self.artifact_provenance[artifact_type] = provenance

    def snapshot(self) -> dict[str, Any]:
        return {
            "task": self.task,
            "artifacts": dict(self.artifacts),
            "artifact_provenance": dict(self.artifact_provenance),
        }
