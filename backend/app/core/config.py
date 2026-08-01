from pydantic_settings import BaseSettings
from pydantic import model_validator
from functools import lru_cache

# The shipped dev default — MUST be overridden in production (guarded below).
_DEFAULT_SECRET = "dev-secret-key-change-in-production-must-be-32-chars-min"


class Settings(BaseSettings):
    # Set ENV=production on the live server to turn on the safety guards below.
    ENV: str = "development"

    DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/rsp_db"
    SECRET_KEY: str = _DEFAULT_SECRET
    ALGORITHM: str = "HS256"
    # Access token is SHORT-lived now — if it leaks it's near-worthless. Longevity
    # ("stay logged in for weeks") is provided by the revocable refresh token below,
    # which silently mints new access tokens. See app/modules/auth/service.py.
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    # Refresh token lifetime. Sliding — each use pushes the expiry forward, so an
    # actively-used session never has to log in again; an idle one expires here.
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # Only emails on this domain may be added / may log in (department restriction).
    ALLOWED_EMAIL_DOMAIN: str = "iitk.ac.in"

    # Wall-clock zone for user-facing dates in notifications and conflict messages.
    # Pinned (not the server's ambient TZ) so those strings stay correct even if the
    # host is set to UTC or moved. IANA name; override via env for another deployment.
    APP_TIMEZONE: str = "Asia/Kolkata"

    # Comma-separated list of allowed browser origins. "*" is fine for local dev;
    # in production this MUST be your real frontend origin(s).
    CORS_ORIGINS: str = "*"

    # When set to the path of the built frontend (dist/), uvicorn also SERVES the
    # frontend itself — no nginx needed. Used for the offline / single-process
    # deployment. Leave empty in dev (Vite serves the frontend) and in the
    # nginx-fronted setup (nginx serves the static files).
    SERVE_FRONTEND_DIR: str = ""

    # SMTP (email). All optional; email no-ops if unset.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""

    class Config:
        env_file = ".env"

    @property
    def is_production(self) -> bool:
        return self.ENV.strip().lower() in ("production", "prod")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()] or ["*"]

    @model_validator(mode="after")
    def _production_guards(self):
        # Refuse to boot with insecure defaults once ENV=production.
        if self.is_production:
            problems = []
            if self.SECRET_KEY == _DEFAULT_SECRET or len(self.SECRET_KEY) < 32:
                problems.append("SECRET_KEY must be a strong 32+ char value (not the default)")
            if "postgres:password@" in self.DATABASE_URL:
                problems.append("DATABASE_URL still uses the default credentials")
            if self.CORS_ORIGINS.strip() == "*":
                problems.append("CORS_ORIGINS must list your real domain(s), not '*'")
            if problems:
                raise ValueError(
                    "Refusing to start — insecure production config: " + "; ".join(problems)
                )
        return self


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
