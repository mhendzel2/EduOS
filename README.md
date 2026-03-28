# EduOS

EduOS is a review-first educational studio for turning source material into evidence-aware website and YouTube outputs. The current build combines a Next.js frontend, a FastAPI backend, project-scoped artifacts and memory, configurable model routing, and workflow-driven writing, media, promo, and review workforces.

The primary brand target in this repo is **CellNucleus**:

- website: `https://www.cellnucleus.com`
- channel: `CellNucleus`
- output style: rigorous, uncertainty-aware educational publishing for advanced biology learners

## Product Focus

EduOS is not meant to be a generic creative studio. The intended workflow is:

1. define a scientific question or hypothesis worth teaching
2. collect source material and preserve provenance
3. run structured review passes with explicit evidence standards
4. synthesize the result into a canonical educational review
5. package that review for web publication, YouTube production, and downstream NotebookLM handoff

The current review direction emphasizes:

- separating established facts from hypotheses, caveats, and open questions
- preserving uncertainty in scripts instead of flattening it into false certainty
- storing reusable review artifacts, prompt templates, memory, and run history
- passing media work through review gates such as `accuracy_reviewer`

## Current Capabilities

- project management with validated `writing`, `web`, and `youtube` domains
- document upload, folder import, artifact storage, and semantic document search
- project chat plus workflow-command planning and execution
- story bible, brand bible, project memory, and workspace memory surfaces
- pipeline builder and workforce execution across writing, media, promo, coordination, and review modules
- model routing and catalog refresh for OpenRouter, Google/Gemini, Ollama, OpenAI, and Anthropic
- media tools, render jobs, Google OAuth runtime status, Ollama bootstrap, and Telegram control surfaces

## Repository Layout

- `frontend/`: Next.js 15 App Router UI
- `backend/`: FastAPI API, agents, workflows, persistence, and tests
- `scripts/`: local development helpers for backend, frontend, Redis, and stack checks

## Default Local Ports

- frontend: `http://127.0.0.1:3090`
- backend: `http://127.0.0.1:8090`
- backend health: `http://127.0.0.1:8090/api/v1/health`
- Redis: `redis://127.0.0.1:6379/0`
- Ollama: `http://127.0.0.1:11434`

## Prerequisites

- Python 3 with `venv`
- Node.js with `npm`
- at least one configured LLM provider key in `.env`
- Redis if you want to use the supplied local stack-check script
- Ollama if you want local autofill and local workflow routing

## Environment Setup

1. Copy `.env.example` to `.env` at the repository root.
2. Set at least one provider key such as `OPENROUTER_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`.
3. Keep `NEXT_PUBLIC_API_URL=http://127.0.0.1:8090` unless you are targeting a different backend.
4. If you want Google OAuth features, place your OAuth client JSON at the repo root as `google-oauth-client.json`, or point `GOOGLE_OAUTH_CLIENT_FILE` at another path.
5. Use `backend/.env` only for backend-specific overrides. The root `.env` is the shared source of truth for local development scripts and the frontend API target.

Important environment variables:

- `NEXT_PUBLIC_API_URL`: frontend target for the backend API
- `PROVIDER_PRIORITY` and `DEFAULT_MODEL`: top-level routing defaults
- `LOCAL_AUTOFILL_MODEL` and `LOCAL_WORKFLOW_MODEL`: local Ollama-backed behavior
- `GOOGLE_OAUTH_CLIENT_FILE`: Google OAuth client JSON path
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_POLLING_ENABLED`: optional Telegram remote control

## Install Dependencies

### Windows PowerShell

Create the virtual environment and install backend dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

Install frontend dependencies:

```powershell
cd .\frontend
npm install
```

### Unix Shell

Create the virtual environment and install backend dependencies:

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -r ./backend/requirements.txt
```

Install frontend dependencies:

```bash
cd frontend
npm install
```

## Run Locally

The helper scripts load the repository root `.env` automatically.

### Windows PowerShell

Start the backend:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev_backend.ps1
```

Start the frontend:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev_frontend.ps1
```

Start both in separate PowerShell windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev_stack.ps1
```

Verify the local stack:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check_local_stack.ps1
```

### Unix Shell

Start Redis if you want the full local stack and stack-check parity:

```bash
./scripts/dev_redis.sh
```

Start the backend:

```bash
./scripts/dev_backend.sh
```

Start the frontend:

```bash
./scripts/dev_frontend.sh
```

Verify the local stack:

```bash
./scripts/check_local_stack.sh
```

## Testing

Backend test coverage currently includes config, routing, document flows, memory, model routing, pipeline builder, workflow commands, render jobs, Google OAuth runtime, Telegram control, and YouTube feedback.

Run backend tests from `backend/`:

```bash
cd backend
../.venv/bin/pytest tests
```

Run a frontend production build from `frontend/`:

```bash
cd frontend
npm run build
```

## Notes

- The frontend redirects `/` to `/workspace`.
- The UI currently exposes Workspace, Projects, Writing Studio, Media Studio, Promo Studio, Story Bible, Brand Bible, Memory, Prompt Library, Pipeline Builder, Run History, Workforces, and Settings.
- Some UI copy and internal module names still reference `StudioOS` or `ResearchAgent` while the repo is being migrated to EduOS naming.
