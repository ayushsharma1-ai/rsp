import logging
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.database import Base, engine
from app.core.config import settings
from app.core.limiter import limiter          # ← from core, not main
from app.modules import models                # noqa
from app.api.v1.routes import auth, resources, bookings, users, feedback, availability, groups, clash, release, event_kinds
from app.modules.notifications.service import register_handlers
from app.modules.email.service import register_email_handlers

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)
register_handlers()
register_email_handlers()

# Hide the interactive API docs in production — they advertise every endpoint and
# schema to anyone on the internet (a "security misconfiguration" / info-disclosure
# finding in a VAPT). In dev they stay on at /docs and /redoc for convenience.
_docs_kwargs = (
    dict(docs_url=None, redoc_url=None, openapi_url=None)
    if settings.is_production
    else {}
)

app = FastAPI(
    title="Resource Scheduling Platform",
    version="1.0.0",
    **_docs_kwargs,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,   # "*" in dev; your real domain(s) in prod
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.method} {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please try again later."},
    )

app.include_router(auth.router,      prefix="/api/v1")
app.include_router(resources.router, prefix="/api/v1")
app.include_router(bookings.router,  prefix="/api/v1")
app.include_router(users.router,     prefix="/api/v1")
app.include_router(feedback.router, prefix="/api/v1")
app.include_router(availability.router, prefix="/api/v1")
app.include_router(groups.router,       prefix="/api/v1")
app.include_router(clash.router,        prefix="/api/v1")
app.include_router(release.router,      prefix="/api/v1")
app.include_router(event_kinds.router,  prefix="/api/v1")

@app.get("/health")
def health():
    return {"status": "ok"}


# Single-process serving (no nginx): when SERVE_FRONTEND_DIR points at the built
# frontend, uvicorn serves it too. Mounted LAST so /api/* and /health match first;
# everything else falls through to the static files (index.html for "/"). v3 uses
# hash routing, so no server-side SPA rewrite is needed.
if settings.SERVE_FRONTEND_DIR and os.path.isdir(settings.SERVE_FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=settings.SERVE_FRONTEND_DIR, html=True), name="frontend")
    logger.info(f"Serving frontend from {settings.SERVE_FRONTEND_DIR}")
