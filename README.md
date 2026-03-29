# EduOS

> **Evidence-aware science publishing studio for CellNucleus — rigorous AI-assisted educational content for advanced biology.**

EduOS is the production platform for [CellNucleus](https://www.cellnucleus.com), a science communication channel and website dedicated to evidence-aware biology content. It is explicitly designed as an experiment in whether AI can contribute meaningfully to scientific review — producing content with the depth and rigour of formal review articles while being openly accessible, uncertainty-transparent, and continuously updatable.

EduOS is not a generic content studio. Every output goes through a structured review pipeline that separates established facts from hypotheses, preserves uncertainty rather than flattening it, and maintains evidence provenance from source material through to published content.

---

## Mission

CellNucleus publishes rigorous, uncertainty-aware science content for advanced biology learners. The editorial standard is:

- **Separate established facts from hypotheses and open questions** — never present contested claims as settled
- **Preserve uncertainty** — scripts acknowledge what is unknown, not just what is known
- **Maintain provenance** — source material is indexed and linked throughout the review pipeline
- **Reduce author bias** — AI-assisted synthesis integrates the broader literature without the perspective distortions of a single research program
- **Stay current** — living reviews updated as the field evolves, not static snapshots

The long-term goal is to displace paywalled, author-biased review articles with openly accessible, AI-transparent, living scientific reviews — starting with cell nucleus and chromatin biology and expanding from there.

---

## CellNucleus Brand

| Property | Value |
|---|---|
| Website | `https://www.cellnucleus.com` |
| YouTube channel | CellNucleus |
| Output style | Rigorous, uncertainty-aware educational publishing |
| Target audience | Advanced biology learners, researchers, graduate students |
| Source path | `C:/Users/mjhen/Github/cellnucleus.com` |

---

## Workflow

1. Define a scientific question or hypothesis worth reviewing
2. Collect source material and preserve provenance via document upload or folder import
3. Run structured review passes with explicit evidence standards
4. Synthesize the result into a canonical educational review artifact
5. Package for web publication, YouTube production, and NotebookLM handoff

---

## Current Capabilities

- Project management with validated `writing`, `web`, and `youtube` domains
- Document upload, folder import, artifact storage, and semantic document search
- Project chat plus workflow-command planning and execution
- Story bible, brand bible, project memory, and workspace memory surfaces
- Pipeline builder and workforce execution across writing, media, promo, coordination, and review modules
- Model routing and catalog refresh for OpenRouter, Google/Gemini, Ollama, OpenAI, and Anthropic
- Media tools, render jobs, Google OAuth runtime status, Ollama bootstrap, and Telegram control surfaces
- Accuracy review gate (`accuracy_reviewer`) mandatory for all media outputs

---

## Workforce Architecture

EduOS shares the same workforce architecture as StudioOS but is configured for science communication:

| Workforce | Science-specific role |
|---|---|
| **Writing** | Drafts evidence-anchored review sections and educational scripts |
| **Review** | Accuracy reviewer, audience reviewer, council — all gate on evidence standards |
| **Media** | Adapts reviewed content into YouTube scripts, shorts, and web articles |
| **Promo** | Schedules content releases and extracts audience-appropriate hooks |
| **Coordination** | Director sequences workforces and manages review dependencies |

---

## Repository Layout

```
EduOS/
├── backend/
│   ├── main.py                   FastAPI app
│   ├── config.py                 Settings (Pydantic BaseSettings)
│   ├── database.py               SQLAlchemy engine
│   ├── database_models.py        ORM models
│   ├── agents/
│   │   ├── base_agent.py
│   │   ├── registry.py
│   │   └── workforces/           writing, review, media, promo, coordination
│   ├── workflows/
│   │   ├── pipeline.py           StudioPipeline — step execution with gate checks
│   │   ├── planner.py            StudioPlan builder
│   │   ├── gate.py               Gate evaluation (accuracy_reviewer is mandatory)
│   │   ├── governance.py         Governance rules
│   │   ├── artifact_contracts.py Typed artifact schemas
│   │   └── state.py              SharedState — cross-step context
│   └── services/
│       ├── memory.py             Project and workspace memory
│       ├── model_catalog.py      Model routing
│       ├── media_tools.py        Media tool context
│       ├── document_indexing.py  Source document ingestion and semantic search
│       ├── render_jobs.py        Background render queue
│       ├── youtube_feedback.py   YouTube analytics feedback loop
│       ├── prompt_library.py     Reusable evidence-standard prompt templates
│       └── telegram_control.py  Telegram remote control
├── frontend/
│   └── app/
│       ├── workspace/            Project workspace and chat
│       ├── writing-studio/       Draft creation interface
│       ├── media-studio/         Script and video production
│       ├── promo-studio/         Campaign planning
│       ├── story-bible/          Scientific framework and world reference
│       ├── brand-bible/          CellNucleus brand identity
│       ├── pipeline/             Workflow pipeline builder
│       ├── memory/               Project memory surfaces
│       ├── prompt-library/       Prompt template library
│       └── provenance/           Artifact and run history
└── scripts/                      Dev helper scripts (backend, frontend, Redis, stack check)
```

---

## Default Local Ports

| Service | URL |
|---|---|
| Frontend | `http://127.0.0.1:3090` |
| Backend | `http://127.0.0.1:8090` |
| Backend health | `http://127.0.0.1:8090/api/v1/health` |
| Redis | `redis://127.0.0.1:6379/0` |
| Ollama | `http://127.0.0.1:11434` |

---

## Prerequisites

- Python 3 with `venv`
- Node.js with `npm`
- At least one configured LLM provider key in `.env`
- Redis (optional — for stack-check script parity)
- Ollama (optional — for local autofill and local workflow routing)

---

## Environment Setup

1. Copy `.env.example` to `.env` at the repository root.
2. Set at least one provider key: `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`.
3. Keep `NEXT_PUBLIC_API_URL=http://127.0.0.1:8090` unless targeting a different backend.
4. For Google OAuth features, place your OAuth client JSON at the repo root as `google-oauth-client.json`, or set `GOOGLE_OAUTH_CLIENT_FILE`.

Key environment variables:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Frontend target for the backend API |
| `PROVIDER_PRIORITY` | LLM provider resolution order |
| `DEFAULT_MODEL` | Default model for routing |
| `LOCAL_AUTOFILL_MODEL` | Ollama model for local autofill |
| `LOCAL_WORKFLOW_MODEL` | Ollama model for local workflow steps |
| `GOOGLE_OAUTH_CLIENT_FILE` | Path to Google OAuth client JSON |
| `CELLNUCLEUS_SITE_PATH` | Local path for the CellNucleus website workspace |
| `AGENT0_WORKDIR` | Base directory for Agent0 project imports |
| `TELEGRAM_BOT_TOKEN` | Optional Telegram remote control |
| `TELEGRAM_POLLING_ENABLED` | Enable Telegram polling |

---

## Installation

### Windows (PowerShell)

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
cd .\frontend && npm install
```

### Unix

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -r ./backend/requirements.txt
cd frontend && npm install
```

---

## Running

### Windows

```powershell
# Backend
powershell -ExecutionPolicy Bypass -File .\scripts\dev_backend.ps1

# Frontend
powershell -ExecutionPolicy Bypass -File .\scripts\dev_frontend.ps1

# Both
powershell -ExecutionPolicy Bypass -File .\scripts\dev_stack.ps1
```

### Unix

```bash
./scripts/dev_backend.sh
./scripts/dev_frontend.sh
```

---

## Testing

```bash
cd backend
../.venv/bin/pytest tests
```

```bash
cd frontend
npm run build
```

---

## Notes

- Frontend redirects `/` to `/workspace`.
- The `accuracy_reviewer` gate is mandatory for all media outputs — content that fails the accuracy gate is blocked from advancing to production.
- ResearchAgent integration: research synthesis outputs from ResearchAgent can be imported directly as EduOS project source material, creating a pipeline from lab findings to CellNucleus content.
