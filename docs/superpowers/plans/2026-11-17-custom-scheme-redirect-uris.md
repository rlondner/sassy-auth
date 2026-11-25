# Custom-Scheme Redirect URIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SaApp apps register custom-scheme redirect URIs (e.g. `com.vibecast.app://auth`) for mobile/native OAuth flows, with reverse-domain scheme naming and mandatory PKCE, and fix the admin UI error message that currently mislabels any redirect-URI validation failure as an https/public-host policy error.

**Architecture:** One shared predicate (`isCustomSchemeRedirect`) added to the existing `redirect-uri.ts` module decides whether a given redirect URI is non-http(s); it's consumed at the two points that currently assume "confidential app ⇒ PKCE optional" (`/authorize` in `token.controller.ts`, and the signup-flow redirect in `registration.service.ts`) to force PKCE whenever the redirect is a custom scheme. A second, independent change loosens the admin-side scheme allowlist in `apps.service.ts` from "http(s) only" to "http(s) or reverse-domain custom scheme," and a third fixes the admin UI's error-message mapping so a rejected redirect URI no longer displays the unrelated https/public-host message.

**Tech Stack:** NestJS (auth-server), Next.js Server Actions (admin), Jest, class-validator, Prisma (no schema change).

**Spec:** `docs/superpowers/specs/2026-11-16-custom-scheme-redirect-uris-design.md`

---

### Task 1: `isCustomSchemeRedirect` helper

**Files:**
- Modify: `apps/auth-server/src/token/redirect-uri.ts`
- Test: `apps/auth-server/src/token/redirect-uri.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `apps/auth-server/src/token/redirect-uri.spec.ts`:

```ts
describe('isCustomSchemeRedirect', () => {
  it('returns false for http(s) URIs', () => {
    expect(isCustomSchemeRedirect('https://app.example.com/cb')).toBe(false);
    expect(isCustomSchemeRedirect('http://app.example.com/cb')).toBe(false);
  });

  it('returns true for a custom-scheme URI', () => {
    expect(isCustomSchemeRedirect('com.vibecast.app://auth')).toBe(true);
  });

  it('returns false for an unparseable URI', () => {
    expect(isCustomSchemeRedirect('not a url')).toBe(false);
  });
});
```

Add `isCustomSchemeRedirect` to the existing import line at the top of the file:

```ts
import { assertRedirectUriAllowed, assertPostLogoutRedirectUriAllowed, isCustomSchemeRedirect } from './redirect-uri';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/auth-server && npm test -- redirect-uri.spec.ts`
Expected: FAIL — `isCustomSchemeRedirect is not a function` (or TypeScript fails to compile the import).

- [ ] **Step 3: Implement the helper**

In `apps/auth-server/src/token/redirect-uri.ts`, add this exported function (placed after `reject()`, before `isExactMatch`):

```ts
/**
 * Whether `uri`'s scheme is anything other than http/https — i.e. a
 * mobile/native custom-scheme redirect (e.g. `com.example.app://auth`).
 * An unparseable URI is not a custom scheme for this purpose: callers that
 * use this to decide whether PKCE is mandatory still reject the URI via
 * the normal exact-match/parse-failure path immediately afterward.
 */
export function isCustomSchemeRedirect(uri: string): boolean {
  try {
    const { protocol } = new URL(uri);
    return protocol !== 'http:' && protocol !== 'https:';
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/auth-server && npm test -- redirect-uri.spec.ts`
Expected: PASS (all tests in the file, including the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/redirect-uri.ts apps/auth-server/src/token/redirect-uri.spec.ts
git commit -m "feat: add isCustomSchemeRedirect helper for custom-scheme PKCE enforcement"
```

---

### Task 2: Allow reverse-domain custom schemes in redirect URI registration

**Files:**
- Modify: `apps/auth-server/src/apps/apps.service.ts:74-100`
- Test: `apps/auth-server/src/apps/apps.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests directly after the existing `it('rejects a redirect URI that is not an absolute http(s) URL', ...)` test (around line 1001) in `apps/auth-server/src/apps/apps.service.spec.ts`:

```ts
  it('accepts a reverse-domain custom-scheme redirect URI', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });
    mockPrisma.saApp.update.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });

    await service.updateApp('admin-ba-id', 'a_7', {
      redirectUris: [{ uri: 'com.vibecast.app://auth', kind: 'login' }],
    });

    expect(mockPrisma.saAppRedirectUri.createMany).toHaveBeenCalledWith({
      data: [{ appId: 7, uri: 'com.vibecast.app://auth', kind: 'login' }],
    });
  });

  it('rejects a bare-word custom scheme (no reverse-domain dot)', async () => {
    mockPrisma.saApp.findUnique.mockResolvedValue({ id: 7, publicId: 'a_7', isPlatform: false });

    await expect(
      service.updateApp('admin-ba-id', 'a_7', {
        redirectUris: [{ uri: 'vibecast://auth', kind: 'login' }],
      }),
    ).rejects.toThrow('Redirect URI scheme must be http(s) or reverse-domain');
  });
```

This mirrors the existing `it('replaces the redirect URI set on update', ...)` test immediately above (around line 973) — same minimal `findUnique`/`saApp.update` mocks, asserting on `saAppRedirectUri.createMany` rather than on `updateApp`'s return value, so it doesn't depend on mocking every field `updateApp`'s row-mapping touches.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/auth-server && npm test -- apps.service.spec.ts -t "custom-scheme"`
Expected: FAIL — the "accepts" test rejects with `Redirect URI must be http(s)`; the "rejects" test's thrown message doesn't match `Redirect URI scheme must be http(s) or reverse-domain` (old message is `Redirect URI must be http(s): ...`).

- [ ] **Step 3: Implement the scheme check**

In `apps/auth-server/src/apps/apps.service.ts`, replace lines 74-86:

```ts
/** Redirect URIs must be absolute http(s) URLs — no javascript:, data:, or relative paths. */
function assertValidRedirectUris(uris: Array<{ uri: string; kind: string }>): void {
  const seen = new Set<string>();
  for (const r of uris) {
    let parsed: URL;
    try {
      parsed = new URL(r.uri);
    } catch {
      throw new BadRequestException(`Invalid redirect URI: ${r.uri}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BadRequestException(`Redirect URI must be http(s): ${r.uri}`);
    }
```

with:

```ts
// At least two dot-separated labels (e.g. "com.example.app") — RFC 8252
// §7.1 reverse-domain custom-scheme notation.
const CUSTOM_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+-]*(\.[a-zA-Z][a-zA-Z0-9+-]*)+$/;

/**
 * Redirect URIs must be absolute http(s) URLs, or a reverse-domain
 * custom scheme (e.g. com.example.app://auth) for mobile/native apps per
 * RFC 8252 §7.1 — never javascript:, data:, a bare-word scheme, or a
 * relative path. A bare-word scheme (no dot) is rejected because it can be
 * claimed by more than one app on a device, letting another app intercept
 * the authorization code.
 */
function assertValidRedirectUris(uris: Array<{ uri: string; kind: string }>): void {
  const seen = new Set<string>();
  for (const r of uris) {
    let parsed: URL;
    try {
      parsed = new URL(r.uri);
    } catch {
      throw new BadRequestException(`Invalid redirect URI: ${r.uri}`);
    }
    const schemeName = parsed.protocol.slice(0, -1);
    const isHttpLike = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (!isHttpLike && !CUSTOM_SCHEME_RE.test(schemeName)) {
      throw new BadRequestException(
        `Redirect URI scheme must be http(s) or reverse-domain (e.g. com.example.app): ${r.uri}`,
      );
    }
```

(The rest of the function — the `kind` check and the duplicate-detection block — is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/auth-server && npm test -- apps.service.spec.ts`
Expected: PASS — all tests in the file, including the pre-existing `javascript:alert(1)` rejection test (still rejected: `javascript` has no dot, so it fails `CUSTOM_SCHEME_RE` too) and the two new tests.

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/apps/apps.service.ts apps/auth-server/src/apps/apps.service.spec.ts
git commit -m "feat: allow reverse-domain custom-scheme redirect URIs"
```

---

### Task 3: Require PKCE for custom-scheme redirects at `/authorize`

**Files:**
- Modify: `apps/auth-server/src/token/token.controller.ts:172-183`
- Test: `apps/auth-server/src/token/token.controller.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this test directly after `it('/authorize allows omitting PKCE for a confidential app', ...)` (around line 1398) in `apps/auth-server/src/token/token.controller.spec.ts`, inside the same `describe('confidential client invariants', ...)` block:

```ts
    it('/authorize refuses to omit PKCE for a confidential app using a custom-scheme redirect', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({
        id: 7, publicId: 'a_7', url: 'https://app.example.com',
        clientSecretHash: 'scrypt-hash', redirectUris: [],
      });

      const res = await request(app.getHttpServer())
        .get('/api/token/oauth/authorize')
        .query({ client_id: 'a_7', redirect_uri: 'com.vibecast.app://auth', scope: 'openid' });

      expect(res.status).toBe(400);
      expect(mockOauthService.generateCode).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/auth-server && npm test -- token.controller.spec.ts -t "custom-scheme redirect"`
Expected: FAIL — status is not 400 (the confidential app is allowed to omit PKCE today regardless of scheme; the request instead fails later, e.g. on session/redirect-uri checks, with a different status).

- [ ] **Step 3: Implement the PKCE gate**

In `apps/auth-server/src/token/token.controller.ts`, update the import on line 52:

```ts
import { assertRedirectUriAllowed, assertPostLogoutRedirectUriAllowed, isCustomSchemeRedirect } from './redirect-uri';
```

Replace lines 176-183:

```ts
      const isConfidential = app.clientSecretHash !== null;
      if (codeChallenge) {
        if (codeChallengeMethod !== 'S256') {
          throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
        }
      } else if (!isConfidential) {
        throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
      }
```

with:

```ts
      const isConfidential = app.clientSecretHash !== null;
      // A custom-scheme redirect is always treated as public for PKCE
      // purposes — a client secret embedded in a distributed app binary
      // can't be kept confidential, so the confidential-client exemption
      // from PKCE must not apply to it even if the app also has a secret
      // configured for other flows.
      const pkceRequired = !isConfidential || isCustomSchemeRedirect(redirectUri);
      if (codeChallenge) {
        if (codeChallengeMethod !== 'S256') {
          throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
        }
      } else if (pkceRequired) {
        throw new BadRequestException(TokenErrorCode.INVALID_REQUEST);
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/auth-server && npm test -- token.controller.spec.ts`
Expected: PASS — all tests in the file, including the new one and the two pre-existing confidential/public PKCE tests (unaffected, since both use `https://app.example.com/cb`, which is not a custom scheme).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/token/token.controller.ts apps/auth-server/src/token/token.controller.spec.ts
git commit -m "feat: require PKCE for custom-scheme redirects at /authorize"
```

---

### Task 4: Require PKCE for custom-scheme redirects in the signup-flow redirect

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts:31,349`
- Test: `apps/auth-server/src/registration/registration.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add this test directly after `it('returns a redirectUrl with a signup code when the app is confidential and has a login redirect URI', ...)` (around line 274) in `apps/auth-server/src/registration/registration.service.spec.ts`:

```ts
    it('omits redirectUrl when the app is confidential but its only registered login redirect URI is a custom scheme', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ ...appRow, clientSecretHash: 'hashed-secret' });
      mockPrisma.saOrg.create.mockResolvedValue(draftOrgRow);
      mockPrisma.saOrg.update.mockResolvedValue(finalOrgRow);
      mockSignUpEmail.mockResolvedValue({ user: { id: baUserId } });
      mockPrisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
        cb({
          saOrg: mockPrisma.saOrg,
          saUser: { create: jest.fn().mockResolvedValue({ id: 42, publicId: 'ba-user-id-a' }) },
          saUserRole: mockPrisma.saUserRole,
        }),
      );
      mockPrisma.saAppRedirectUri.findMany.mockResolvedValue([
        { uri: 'com.vibecast.app://auth', kind: 'login' },
      ]);

      const result = await service.register(baseDto);

      expect(mockOauthService.generateCode).not.toHaveBeenCalled();
      expect(result.redirectUrl).toBeUndefined();
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/auth-server && npm test -- registration.service.spec.ts -t "custom scheme"`
Expected: FAIL — `generateCode` is called and `result.redirectUrl` is defined, because today a confidential app skips the PKCE requirement regardless of the redirect URI's scheme.

- [ ] **Step 3: Implement the PKCE gate**

In `apps/auth-server/src/registration/registration.service.ts`, update the import on line 31:

```ts
import { assertRedirectUriAllowed, isCustomSchemeRedirect } from '../token/redirect-uri';
```

Replace line 349:

```ts
      if (redirectUri && (codeChallenge || isConfidential)) {
```

with:

```ts
      // Same custom-scheme-forces-PKCE rule as /authorize (token.controller.ts):
      // a confidential app's client secret doesn't substitute for PKCE when
      // the redirect itself is a mobile/native custom scheme.
      const pkceRequired = !isConfidential || (redirectUri !== null && isCustomSchemeRedirect(redirectUri));
      if (redirectUri && (codeChallenge || !pkceRequired)) {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/auth-server && npm test -- registration.service.spec.ts`
Expected: PASS — all tests in the file, including the new one and the three pre-existing redirectUrl tests (unaffected — they all use `https://...` URIs).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat: require PKCE for custom-scheme redirects in signup-flow redirect"
```

---

### Task 5: Fix admin UI error mapping for redirect-URI validation failures

**Files:**
- Modify: `apps/admin/app/(admin)/apps/actions.ts:12-32`
- Modify: `apps/admin/messages/en.json:198`
- Modify: `apps/admin/messages/fr.json:198`
- Test: `apps/admin/app/(admin)/__tests__/resource-actions.test.ts`

- [ ] **Step 1: Write the failing test**

Add this row to the `it.each` array in `apps/admin/app/(admin)/__tests__/resource-actions.test.ts` (around line 59-63), right after the `'API error 400: url insecure'` row:

```ts
    ['API error 400: Redirect URI scheme must be http(s) or reverse-domain (e.g. com.example.app): vibecast://auth', 'apps.errors.redirectUriInvalid'],
```

So the full array reads:

```ts
  it.each([
    ['API error 409: name taken', 'apps.errors.nameExists'],
    ['API error 403: platform app', 'apps.errors.platformProtected'],
    ['API error 400: url insecure', 'apps.errors.urlInsecure'],
    ['API error 400: Redirect URI scheme must be http(s) or reverse-domain (e.g. com.example.app): vibecast://auth', 'apps.errors.redirectUriInvalid'],
    ['API error 500: boom', 'apps.errors.generic'],
  ])('maps %s to %s on create', async (message, key) => {
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/admin && npm test -- resource-actions.test.ts -t "Redirect URI scheme"`
Expected: FAIL — `mapError` returns `apps.errors.urlInsecure` (the generic 400 fallback) instead of `apps.errors.redirectUriInvalid`.

- [ ] **Step 3: Implement the mapping**

In `apps/admin/app/(admin)/apps/actions.ts`, update `mapError` (currently lines 12-32):

```ts
function mapError(message: string, kind: 'create' | 'update' | 'delete'): string {
  if (message.includes('409')) {
    if (kind === 'delete') return 'apps.errors.hasDependents'
    return 'apps.errors.nameExists'
  }
  if (message.includes('403')) {
    if (kind !== 'delete') return 'apps.errors.platformProtected'
    return 'apps.errors.forbidden'
  }
  // Trailing dot distinguishes an actual field-validation failure
  // ("activationEmailOverride.fromAddress must be...") from the generic
  // "at least one field must be provided" 400, which also names this field
  // in its enumeration but isn't about its value.
  if (message.includes('activationEmailOverride.')) {
    return 'apps.errors.activationEmailInvalid'
  }
  // apps.service.ts's assertValidRedirectUris rejects invalid/duplicate/
  // wrong-scheme redirect URIs with a message that always starts with
  // "Redirect URI" or "Invalid redirect URI" or "Duplicate redirect URI" —
  // none of these are the isAppUrlAllowed https/public-host policy that
  // urlInsecure describes, so they must not fall into that generic bucket.
  if (message.includes('Redirect URI') || message.includes('redirect URI')) {
    return 'apps.errors.redirectUriInvalid'
  }
  if (message.includes('400')) {
    return 'apps.errors.urlInsecure'
  }
  return 'apps.errors.generic'
}
```

In `apps/admin/messages/en.json`, add a new key right after `urlInsecure` (line 198):

```json
      "urlInsecure": "Please enter a valid URL. In production, app and callback URLs must use https and a public host.",
      "redirectUriInvalid": "Please enter a valid redirect URI. Custom schemes must use reverse-domain notation, e.g. com.example.app://callback.",
```

In `apps/admin/messages/fr.json`, add the matching key right after `urlInsecure` (line 198):

```json
      "urlInsecure": "Veuillez saisir une URL valide. En production, les URL d’application et de rappel doivent utiliser https et un hôte public.",
      "redirectUriInvalid": "Veuillez saisir une URI de redirection valide. Les schémas personnalisés doivent utiliser la notation de domaine inversé, par ex. com.example.app://callback.",
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/admin && npm test -- resource-actions.test.ts`
Expected: PASS — all rows in the `it.each` table, including the pre-existing `'API error 400: url insecure'` row (still maps to `urlInsecure`, since that message doesn't contain "Redirect URI"/"redirect URI") and the new row.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/\(admin\)/apps/actions.ts apps/admin/app/\(admin\)/__tests__/resource-actions.test.ts apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "fix: stop mislabeling redirect-URI validation errors as https/public-host policy errors"
```

---

### Task 6: Admin UI copy for custom-scheme redirect URIs

**Files:**
- Modify: `apps/admin/messages/en.json:47`
- Modify: `apps/admin/messages/fr.json:47`

No test — this is a copy-only change (the underlying behavior was already covered by Tasks 1-5's tests; `redirectUriPlaceholder` is rendered verbatim by `redirect-uri-rows-editor.tsx`, which has no logic depending on its content).

- [ ] **Step 1: Update the hint text**

In `apps/admin/messages/en.json`, replace line 47:

```json
      "redirectUrisHint": "Explicit login and post-logout URIs this app is allowed to redirect to.",
```

with:

```json
      "redirectUrisHint": "Explicit login and post-logout URIs this app is allowed to redirect to. For mobile apps, use a reverse-domain custom scheme (e.g. com.example.app://auth) instead of https.",
```

In `apps/admin/messages/fr.json`, replace line 47:

```json
      "redirectUrisHint": "URI de connexion et de déconnexion explicites vers lesquelles cette application est autorisée à rediriger.",
```

with:

```json
      "redirectUrisHint": "URI de connexion et de déconnexion explicites vers lesquelles cette application est autorisée à rediriger. Pour les applications mobiles, utilisez un schéma personnalisé en notation de domaine inversé (par ex. com.example.app://auth) au lieu de https.",
```

- [ ] **Step 2: Verify the admin app still builds**

Run: `cd apps/admin && npm run build`
Expected: Build succeeds (i18n JSON changes don't affect TypeScript compilation, but this confirms the JSON is still valid and next-intl doesn't fail on a missing/malformed key).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "docs: mention custom-scheme redirect URIs in the admin app form"
```

---

### Task 7: Update README OAuth documentation

**Files:**
- Modify: `README.md:779-784`

No test — documentation-only change.

- [ ] **Step 1: Update the redirect_uri validation section**

In `README.md`, after the existing bullet list (around line 782) and before the `A redirect_uri that doesn't satisfy...` paragraph (line 784), insert a new bullet:

```markdown
- **Default (no `login` URI registered for the app):** the `redirect_uri` must share an origin (scheme + host + port) with the app's registered `url`. Any path under that origin is accepted. This is the pre-OIDC behavior, preserved so existing apps keep working unchanged.
- **One or more `login` URIs registered:** the `redirect_uri` must exactly match one of them (scheme + host + port + path + query). A single trailing-slash difference in the path is tolerated; everything else must match byte-for-byte.
- **Custom (mobile/native) schemes:** a registered redirect URI may use a non-http(s) scheme for mobile/native apps, provided the scheme is reverse-domain notation (e.g. `com.example.app://auth`, per RFC 8252 §7.1) rather than a bare word. Any redirect to a custom-scheme URI requires a PKCE `code_challenge` at `/authorize` — the confidential-client exemption from PKCE does not apply to a custom-scheme redirect, even for an app that also has a client secret.
```

(The first two bullets are the existing ones, unchanged — only the third is new. Confirm against the file's current content before editing, since line numbers may have shifted since this plan was written.)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document custom-scheme redirect URI support"
```

---

## Verification

After all 7 tasks:

```bash
cd apps/auth-server && npm test
cd ../admin && npm test
```

Expected: full suites pass in both apps, with no changes to any other test file's outcome.
