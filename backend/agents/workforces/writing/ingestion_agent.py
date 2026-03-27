import json

from agents.base_agent import AgentRequest, AgentResponse, BaseAgent


def _stringify_list_items(value: object) -> list[str]:
    if not isinstance(value, list):
        return []

    rendered: list[str] = []
    for item in value:
        if isinstance(item, str):
            text = item.strip()
        elif isinstance(item, dict):
            preferred_keys = ("name", "title", "summary", "description", "role", "location", "event")
            parts = [str(item[key]).strip() for key in preferred_keys if item.get(key)]
            text = " - ".join(parts) if parts else json.dumps(item, ensure_ascii=True, sort_keys=True)
        else:
            text = str(item).strip()

        if text:
            rendered.append(text)

    return rendered


class ManuscriptIngestionAgent(BaseAgent):
    def __init__(self):
        super().__init__(
            name="ManuscriptIngestionAgent",
            role_description="Extracts manuscript state into story bible primitives.",
            artifact_type="ingestion_report",
            system_prompt=(
                "You are an expert literary editor tasked with analyzing a manuscript payload. "
                "Extract named characters, distinct locations/settings, and summarize the core plot events. "
                "Return a strictly valid JSON object with keys new_characters, new_locations, and plot_points."
            ),
        )

    async def process(self, request: AgentRequest) -> AgentResponse:
        response = await super().process(request)
        if response.confidence <= 0.2:
            return response

        raw_content = response.content.strip()
        if raw_content.startswith("```json"):
            raw_content = raw_content[7:-3]
        elif raw_content.startswith("```"):
            raw_content = raw_content[3:-3]

        try:
            parsed = json.loads(raw_content.strip())
        except json.JSONDecodeError:
            return response

        parts: list[str] = ["Manuscript successfully ingested."]
        new_characters = _stringify_list_items(parsed.get("new_characters"))
        new_locations = _stringify_list_items(parsed.get("new_locations"))
        plot_points = _stringify_list_items(parsed.get("plot_points"))

        if new_characters:
            parts.append("Characters:\n- " + "\n- ".join(new_characters))
        if new_locations:
            parts.append("Locations:\n- " + "\n- ".join(new_locations))
        if plot_points:
            parts.append("Plot Points:\n- " + "\n- ".join(plot_points))

        response.content = "\n\n".join(parts)
        response.metadata["parsed"] = parsed
        return response
