from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    AUTH_SERVER_URL: str = "http://localhost:3000"
    ADMIN_URL: str = "http://localhost:3001"
    SASSY_CLIENT_ID: str
    RS_BASE_URL: str
    REDIRECT_URI: str

    EXPECTED_ISSUER: str | None = None
    EXPECTED_AUDIENCE: str | None = None
    PKCE_STATE_TTL_SECONDS: int = 600
    LOG_LEVEL: str = "info"

    DD_API_KEY: str | None = None
    DD_SITE: str = "datadoghq.com"
    SENTRY_DSN_RESOURCE_SERVER: str | None = None
    SENTRY_ENVIRONMENT: str | None = None
    OTEL_SERVICE_NAME: str = "sassy-auth-resource-server"

    @property
    def issuer(self) -> str:
        return self.EXPECTED_ISSUER or self.AUTH_SERVER_URL

    @property
    def audience(self) -> str:
        return self.EXPECTED_AUDIENCE or self.SASSY_CLIENT_ID


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
