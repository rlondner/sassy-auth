# resource-server-fastapi

A minimal Python/FastAPI OAuth 2.0 resource server demonstrating SassyAuth's
authorization-code + PKCE flow.

## Run

```bash
uv sync
cp .env.example .env  # set SASSY_CLIENT_ID etc.
uv run uvicorn app.main:app --port 8010 --reload
```

Requires the auth-server (`localhost:3000`) and admin (`localhost:3001`) to be
running, and the demo seed (`SEED_DEMO=1 pnpm --filter @sassy-auth/auth-server seed`)
to have populated `resourceserver01` + the two demo users.

## Demo users (from the seed)

- `m@cpm.io` / `Pass@word1234` → role `Citadel Property Managers` (has `rs.properties.create`)
- `i@cpm.io` / `Pass@word1234` → role `Citadel Inspectors` (does not)

After Sign In, the protected `/api/properties` endpoint returns
`{ "result": "Authorized" }` for the first user, `403` with
`{ "result": "Unauthorized", "reason": "insufficient_scope" }` for the second.

## Tests

```bash
uv run pytest
```
