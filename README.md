# EduOS

> Multi-agent publishing and education workspace for evidence-grounded cell biology content.

## Overview

EduOS is the educational content stack in the WebSMBOSS ecosystem. It combines writing, review, media, and promotion workflows to turn scientific source material into explainers, scripts, and supporting assets, with accuracy review acting as a hard gate.

## Repository Layout

- `backend/` contains the FastAPI app and workforce logic.
- `frontend/` contains the Next.js workspace UI.
- `scripts/` contains local development helpers for backend, frontend, and stack checks.
- `.env.example` captures the shared local configuration surface.

## Quick Start

```bash
cp .env.example .env
python -m venv .venv
source .venv/bin/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
cd frontend
npm install
cd ..
```

Run the local stack:

```bash
bash scripts/dev_backend.sh
bash scripts/dev_frontend.sh
```

Windows PowerShell equivalents are available in `scripts/dev_backend.ps1` and `scripts/dev_frontend.ps1`.

Current local ports:

- Backend: `http://127.0.0.1:8090`
- Frontend: `http://127.0.0.1:3090`

## Notes

- `GOOGLE_OAUTH_CLIENT_FILE` and model-provider keys are optional but expected for the full workflow surface.
- The frontend and backend share environment through the repo-root `.env`, not separate duplicated config by default.
