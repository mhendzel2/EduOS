from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes import get_telegram_control_service, router
from config import settings
from database import SessionLocal, init_db
from services.prompt_library import ensure_default_prompt_templates
from services.render_jobs import get_render_queue_service

MAX_REQUEST_BODY_BYTES = settings.MAX_REQUEST_BODY_BYTES
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    os.makedirs(settings.VECTOR_DB_PATH, exist_ok=True)
    init_db()
    with SessionLocal() as db:
        ensure_default_prompt_templates(db)
    render_queue = get_render_queue_service()
    if settings.RENDER_EMBEDDED_WORKER_ENABLED:
        await render_queue.start()
        logger.info("Embedded render worker enabled")
    else:
        logger.info("Embedded render worker disabled")
    telegram_service = get_telegram_control_service()
    if telegram_service.enabled:
        try:
            await telegram_service.start()
            logger.info("Telegram control initialized (polling_enabled=%s)", telegram_service.polling_enabled)
        except Exception:
            logger.warning("Telegram control failed to start", exc_info=True)
    else:
        logger.info("Telegram control disabled")
    yield
    await telegram_service.stop()
    if settings.RENDER_EMBEDDED_WORKER_ENABLED:
        await render_queue.stop()


app = FastAPI(
    title=settings.APP_NAME,
    description="Studio operating system for writing, media, and promo workflows.",
    version=settings.API_VERSION,
    lifespan=lifespan,
)


@app.middleware("http")
async def limit_request_body(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_REQUEST_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": "Request body too large"})
    return await call_next(request)


allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        (
            "http://localhost:3015,http://localhost:3016,http://127.0.0.1:3015,http://127.0.0.1:3016,"
            "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"
        ),
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Studio-Filename", "X-Studio-Source-Path"],
)

app.include_router(router, prefix=f"/api/{settings.API_VERSION}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8015, reload=settings.DEBUG)
