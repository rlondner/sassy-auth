# SassyAuth — Data Model & Core Auth Engine Design

**Date:** 2026-05-25
**Scope:** Sub-project 1 of 5 — foundational layer that all other sub-projects build on.
**Stack:** NestJS (Express adapter) · NextJS · PostgreSQL · Prisma · BetterAuth · Turborepo

---

## 1. Project Structure

The repository is a Turborepo monorepo with two apps and two shared packages:

```
sassy-auth/
├── apps/
│   ├── auth-server/             # NestJS — auth server & management API
│   │   └── src/
│   │       ├── auth/            # BetterAuth mount + JWT module
│   │       ├── users/           # User CRUD module
│   │       ├── orgs/            # Org CRUD module
│   │       ├── apps/            # App/resource-server CRUD module
│   │       ├── permissions/     # Permission CRUD module
│   │       └── roles/           # Role CRUD module
│   └── management-ui/           # NextJS — SassyAuth management UI
├── packages/
│   ├── db/                      # Prisma schema + generated client (shared)
│   │   ├── schema.prisma
│   │   └── index.ts
│   └── types/                   # Shared TypeScript interfaces and enums
├── turbo.json
└── package.json
```

`packages/db` is the single source of truth for the database schema. Both `auth-server` and `management-ui` import `PrismaClient` from it. BetterAuth's Prisma adapter uses the same client instance.

---

## 2. Data Model

### Design principle

BetterAuth owns its standard tables (`user`, `session`, `account`, `verification`). SassyAuth maintains a parallel set of tables prefixed `sa_` linked to BetterAuth's `user` table via a foreign key. This preserves BetterAuth upgrade safety while giving SassyAuth full control over its domain model.

### BetterAuth tables (managed by BetterAuth Prisma adapter)

| Table | Key fields |
|---|---|
| `user` | `id` (String PK), `name`, `email` (unique), `emailVerified`, `image?`, `createdAt`, `updatedAt` |
| `session` | `id`, `token` (unique), `userId` FK→user, `expiresAt`, `ipAddress?`, `userAgent?` |
| `account` | `id`, `providerId`, `accountId`, `userId` FK→user, `password?`, `accessToken?` |
| `verification` | `id`, `identifier`, `value`, `expiresAt` |

### SassyAuth tables

**`sa_app`** — resource servers that use SassyAuth for authentication
```
id          Int      PK autoincrement
publicId    String   unique  (Sqid computed from id, stored on create)
name        String
url         String
isPlatform  Boolean  default false
```

**`sa_org`** — tenants; each org is associated with one app
```
id          Int      PK autoincrement
publicId    String   unique  (Sqid)
name        String
appId       Int      FK→sa_app
isPlatform  Boolean  default false
```

**`sa_user`** — extended user profile, linked 1:1 to BetterAuth's user
```
id                Int      PK autoincrement
publicId          String   unique  (Sqid)
betterAuthUserId  String   unique  FK→user
orgId             Int      FK→sa_org
firstName         String
lastName          String
phoneNumber       String?
username          String?
```

**`sa_permission`** — permissions for either the platform or an app
```
id        Int     PK autoincrement
publicId  String  unique  (Sqid)
name      String  unique  (e.g. "platform.orgs.manage", "invoices.create")
appId     Int     FK→sa_app
```

Platform permissions point to the platform `sa_app` record and are immutable at the application layer (no update/delete allowed via API).

**`sa_role`** — app-scoped role; reusable across all orgs of the same app
```
id        Int     PK autoincrement
publicId  String  unique  (Sqid)
name      String
appId     Int     FK→sa_app
```

**`sa_role_permission`** — many-to-many: roles bundle permissions
```
roleId        Int  FK→sa_role       ┐ composite PK
permissionId  Int  FK→sa_permission ┘
```

**`sa_user_role`** — many-to-many: users assigned roles
```
userId  Int  FK→sa_user ┐ composite PK
roleId  Int  FK→sa_role ┘
```

**`sa_user_permission`** — many-to-many: direct permission grants (additive with role permissions)
```
userId        Int  FK→sa_user        ┐ composite PK
permissionId  Int  FK→sa_permission  ┘
```

### Effective permissions

At JWT issuance time, a user's effective permissions for an app are computed as:

```
effectivePermissions = union(
  sa_user_permission (direct grants),
  sa_role_permission for all roles in sa_user_role
)
```

Duplicates are removed. The result is stored as a flat string array in the JWT `permissions` claim.

### Platform bootstrap (seed)

On first run, a seed script creates:
1. `sa_app { isPlatform: true, name: "SassyAuth", url: "<management UI URL>" }`
2. `sa_org { isPlatform: true, name: "Platform", appId: platformApp.id }`
3. All platform permissions (`platform.orgs.manage`, `platform.apps.manage`, `platform.users.manage`, `platform.permissions.manage`, `org.users.manage`, `org.permissions.manage`) with `appId = platformApp.id`

Platform permissions are never updated or deleted by the application.

### Public IDs (Sqids)

Every `sa_*` entity exposes a `publicId` (Sqid encoded from the numeric `id`) as its external-facing identifier in all API routes and JWT claims. The numeric `id` is never exposed externally. `publicId` is computed once on record creation and stored.

---

## 3. BetterAuth Integration

BetterAuth is mounted on the Express instance before NestJS initializes, intercepting all `/api/auth/*` routes:

```typescript
// apps/auth-server/src/main.ts
async function bootstrap() {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  // BetterAuth handles /api/auth/* before NestJS sees the request
  expressApp.all('/api/auth/*', toNodeHandler(auth));

  await app.listen(3000);
}
```

BetterAuth is configured in `apps/auth-server/src/auth/auth.config.ts`:

```typescript
export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  socialProviders: {
    google:    { clientId: ..., clientSecret: ... },
    microsoft: { clientId: ..., clientSecret: ... },
    apple:     { clientId: ..., clientSecret: ... },
    github:    { clientId: ..., clientSecret: ... },
  },
  plugins: [magicLink(), emailOtp()],
});
```

NestJS never processes `/api/auth/*` routes. All management routes (`/api/users`, `/api/orgs`, etc.) and custom token-issuance routes (`/api/token/*`) are handled by NestJS modules. Custom OAuth2 server and direct-login endpoints live under `/api/token/` specifically to avoid the `/api/auth/*` wildcard.

### Session validation in NestJS

Management API routes that require authentication use a `BetterAuthGuard`:

```typescript
@Injectable()
export class BetterAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedException();
    // session.user is BetterAuth's user object; attach betterAuthUserId so
    // downstream handlers can look up sa_user via betterAuthUserId if needed
    request.betterAuthUser = session.user;
    return true;
  }
}
```

Session tokens are cookie-based (managed by BetterAuth). JWTs are issued only for resource server authentication — not used for management API sessions.

---

## 4. JWT Token Design

### Claims

```json
{
  "iss": "https://auth.yourdomain.com",
  "sub": "<sa_user.publicId>",
  "aud": "<sa_app.publicId>",
  "iat": 1700000000,
  "exp": 1700003600,
  "org": "<sa_org.publicId>",
  "permissions": ["invoices.create", "sales_manager", "reports.read"]
}
```

| Claim | Value | Rationale |
|---|---|---|
| `sub` | `sa_user.publicId` (Sqid) | Resource servers never need BetterAuth's internal user ID |
| `aud` | `sa_app.publicId` | Resource servers reject tokens not addressed to them |
| `org` | `sa_org.publicId` | Enables tenant-scoped data access on resource servers |
| `permissions` | Flat string array (roles resolved) | No RBAC logic required on resource servers |

### Signing

- Algorithm: **RS256**
- Key pair generated on first boot, stored securely (environment variable or secrets manager)
- Public key exposed at `GET /api/token/jwks` as a standard JWKS document
- Token lifetime: **1 hour** (short-lived; no refresh tokens for resource server JWTs)

Resource servers fetch the JWKS endpoint once and cache it, verifying tokens locally without round-trips to SassyAuth.

---

## 5. Auth Flows

### Flow A: OAuth2 Authorization Code (third-party / external resource servers)

1. Resource server redirects user to `GET /api/token/oauth/authorize?client_id=<appPublicId>&redirect_uri=...&state=...`
2. SassyAuth presents hosted login UI. User authenticates via any supported method.
3. SassyAuth validates user's org is associated with the requesting app. Issues a short-lived authorization `code`, redirects to `<redirect_uri>?code=...&state=...`
4. Resource server exchanges code: `POST /api/token/oauth/token` with `{ code, client_id, client_secret, redirect_uri }`
5. SassyAuth resolves effective permissions, returns signed RS256 JWT.

### Flow B: Direct Login (first-party apps and management UI)

1. App POSTs credentials: `POST /api/token/direct/login` with `{ identifier, password, appId }`
2. SassyAuth authenticates via BetterAuth, validates user's org is associated with `appId`.
3. SassyAuth resolves effective permissions, returns signed RS256 JWT in the response body.

The Management UI uses Flow B with `appId = platformApp.publicId`.

**Passwordless variants** (magic link, email OTP, SMS OTP) follow the same structure — the credential step triggers delivery of a code or link, which is then exchanged for the JWT at step 3.

### Supported login methods

| Method | Identifier |
|---|---|
| Password | Username, email address, or phone number |
| Magic link | Email address |
| Email OTP | Email address (6-digit code) |
| SMS OTP | Phone number (6-digit code) |
| Social | Google, Microsoft, Apple, GitHub |

---

## 6. Error Handling

- BetterAuth routes (`/api/auth/*`) return BetterAuth's own error format — not intercepted.
- NestJS routes use a global `HttpExceptionFilter` normalizing all errors to `{ statusCode, message, error }`.
- JWT issuance failures return `403` with a machine-readable reason code:
  - `USER_ORG_MISMATCH` — user's org is not associated with the requested app
  - `APP_NOT_FOUND` — `appId` does not exist
  - `USER_NOT_FOUND` — no `sa_user` record linked to the authenticated BetterAuth user
- `BetterAuthGuard` returns `401` for missing/expired sessions, `403` for insufficient platform permissions.

---

## 7. Testing Strategy

- **Unit tests:** Permission resolution logic (role union + direct grant deduplication) tested in isolation with a mock Prisma client.
- **Integration tests:** NestJS e2e tests against a real PostgreSQL test database (Docker). Cover: sign-in → JWT issuance → JWKS fetch → JWT verification round-trip for both Flow A and Flow B.
- BetterAuth internals are treated as a black box — tested only at the HTTP boundary, never mocked.

---

## Out of Scope for This Sub-Project

The following are designed separately and build on top of this foundation:

- Platform Admin UI (management-ui screens)
- Org Admin UI
- User management CRUD APIs (beyond data model)
- Resource server integration SDK/documentation
