# Signup Captcha (Cloudflare Turnstile) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cloudflare Turnstile captcha to the self-serve `/signup` page so `POST /api/register` can't be scripted/bot-abused, without touching `/login` or `/accept-invite`.

**Architecture:** A Turnstile widget in `apps/admin`'s signup form produces a token that rides along with the rest of the form to `POST /api/register`. `apps/auth-server` verifies that token server-side (Cloudflare `siteverify`, secret key never leaves the server) as the very first step of `RegistrationService.register()`, before any BetterAuth or DB work.

**Tech Stack:** NestJS (`apps/auth-server`), Next.js 15 App Router + `next-intl` (`apps/admin`), Jest + Testing Library, `@marsidev/react-turnstile` (new dependency), Node's global `fetch`.

## Global Constraints

- Captcha applies to `/signup` only — never `/login` or `/accept-invite` (spec §1).
- Verification happens server-side in `apps/auth-server`; the Turnstile secret key must never reach the browser (spec §2, §4).
- A failed/missing captcha must be distinguishable from a DTO-validation (400), app-not-found (404), email-taken (409), or rate-limited (429) failure: use HTTP 422, currently unused by this endpoint (spec §4).
- No `remoteip` is sent to Cloudflare's `siteverify` — don't add `@Req()` to the controller for it (spec §4).
- A transport failure while calling Cloudflare's `siteverify` must fail closed (treated as verification-failed), not fail open (spec §4).
- Dev/test/CI use Cloudflare's documented always-pass test keypair (site key `1x00000000000000000000AA`, secret key `1x0000000000000000000000000000000AA`) — no network-mocking hack needed for local/CI runs; unit tests still mock `fetch` directly for pass/fail branch coverage (spec §5).
- New i18n keys go under the existing `signup.errors` namespace in `apps/admin/messages/en.json`, one key per distinguishable failure mode, matching the existing convention (spec §6).
- All work happens in the existing worktree `.worktrees/dev-oidc-fix` (branch `fix/oidc-discovery-path-and-redirect-uri-exact-match`) — do not create a new branch or worktree.

---

### Task 1: `TurnstileService` (backend verification) + env docs

**Files:**
- Create: `apps/auth-server/src/registration/turnstile.service.ts`
- Test: `apps/auth-server/src/registration/turnstile.service.spec.ts`
- Modify: `.env.example` (append a new section)

**Interfaces:**
- Produces: `TurnstileService.verify(token: string): Promise<boolean>` — `true` iff Cloudflare confirms the token; `false` on missing secret, any non-2xx/non-`success` response, or a transport error (fail closed). Consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Create `apps/auth-server/src/registration/turnstile.service.spec.ts`:

```typescript
import { TurnstileService } from './turnstile.service';

describe('TurnstileService', () => {
  let service: TurnstileService;
  const ORIGINAL_ENV = process.env.TURNSTILE_SECRET_KEY;

  beforeEach(() => {
    service = new TurnstileService();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  it('returns false without calling fetch when TURNSTILE_SECRET_KEY is unset', async () => {
    delete process.env.TURNSTILE_SECRET_KEY;

    await expect(service.verify('some-token')).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts the secret and token to the Cloudflare siteverify endpoint', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await service.verify('the-token');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'test-secret', response: 'the-token' }),
      }),
    );
  });

  it('returns true when Cloudflare responds success: true', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    await expect(service.verify('the-token')).resolves.toBe(true);
  });

  it('returns false when Cloudflare responds success: false', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }),
    });

    await expect(service.verify('bad-token')).resolves.toBe(false);
  });

  it('returns false when the HTTP response is not ok', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(service.verify('the-token')).resolves.toBe(false);
  });

  it('returns false (fails closed) when the fetch call itself rejects', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'test-secret';
    (global.fetch as jest.Mock).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.verify('the-token')).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/auth-server && npx jest registration/turnstile.service.spec.ts`
Expected: FAIL — `Cannot find module './turnstile.service'`

- [ ] **Step 3: Implement `TurnstileService`**

Create `apps/auth-server/src/registration/turnstile.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface SiteverifyResponse {
  success: boolean;
  'error-codes'?: string[];
}

/**
 * Server-side verification of a Cloudflare Turnstile token from the
 * self-serve /signup form. Fails closed: any ambiguity (missing secret,
 * non-2xx response, transport error) is treated as verification-failed,
 * since the whole point is to block automated submissions.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  async verify(token: string): Promise<boolean> {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      this.logger.warn('TURNSTILE_SECRET_KEY is not set; rejecting captcha verification');
      return false;
    }

    try {
      const res = await fetch(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, response: token }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as SiteverifyResponse;
      return body.success === true;
    } catch (e: unknown) {
      this.logger.warn(`Turnstile verification request failed: ${(e as Error).message}`);
      return false;
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/auth-server && npx jest registration/turnstile.service.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Document the env var**

Append to `.env.example` (after the existing `# ── Email ──` section, at the end of the file):

```
# ── Cloudflare Turnstile (signup captcha) ──────────────────
# Secret key for verifying /signup's captcha, auth-server only — never
# exposed to the browser. Unset = every signup captcha check fails closed
# (POST /api/register always rejects with 422).
# For local dev/test/CI, use Cloudflare's documented always-pass test
# secret key: 1x0000000000000000000000000000000AA
# (paired with site key 1x00000000000000000000AA in apps/admin's env —
# see NEXT_PUBLIC_TURNSTILE_SITE_KEY below).
TURNSTILE_SECRET_KEY=
```

- [ ] **Step 6: Commit**

```bash
git add apps/auth-server/src/registration/turnstile.service.ts apps/auth-server/src/registration/turnstile.service.spec.ts .env.example
git commit -m "feat(auth-server): add TurnstileService for signup captcha verification"
```

---

### Task 2: Wire captcha verification into `RegistrationService.register()`

**Files:**
- Modify: `apps/auth-server/src/registration/register.dto.ts`
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.module.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

**Interfaces:**
- Consumes: `TurnstileService.verify(token: string): Promise<boolean>` (Task 1).
- Produces: `RegisterDto.turnstileToken: string` (required field), consumed by Task 3/4 (frontend `actions.ts`/`signup-form.tsx`).

- [ ] **Step 1: Write the failing tests**

In `apps/auth-server/src/registration/registration.service.spec.ts`, add the `TurnstileService` mock and update the fixture. Replace lines 1–6 (imports) with:

```typescript
import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { SqidService } from '../common/sqid/sqid.service';
import { TurnstileService } from './turnstile.service';
import { RegisterDto } from './register.dto';
```

Replace the `baseDto` constant (currently lines 44–51) with:

```typescript
const baseDto: RegisterDto = {
  email: 'alice@example.com',
  password: 'password123',
  firstName: 'Alice',
  lastName: 'Wonder',
  companyName: 'Acme Inc',
  appPublicId: 'sq_1',
  turnstileToken: 'valid-captcha-token',
};
```

Replace the `beforeEach` block (currently lines 61–74) with:

```typescript
  let mockVerify: jest.Mock;

  beforeEach(async () => {
    mockVerify = jest.fn().mockResolvedValue(true);
    const module = await Test.createTestingModule({
      providers: [
        RegistrationService,
        { provide: SqidService, useValue: sqidFake },
        { provide: TurnstileService, useValue: { verify: mockVerify } },
      ],
    }).compile();
    service = module.get(RegistrationService);
    jest.clearAllMocks();
    mockVerify.mockResolvedValue(true);
    // Default: the id signUpEmail returned really was persisted. The
    // synthetic-duplicate cases below override this with null (see
    // auth.config.ts autoSignIn).
    mockPrisma.user.findUnique.mockResolvedValue({ id: baUserId });
  });
```

(`jest.clearAllMocks()` after building `mockVerify` would reset its `mockResolvedValue`, hence re-setting it on the line right after — matches the existing `mockPrisma.user.findUnique` re-set immediately below it.)

Add a new nested `describe` inside the top-level `describe('register', ...)` block, right after its opening line:

```typescript
  describe('register', () => {
    it('throws UnprocessableEntityException when captcha verification fails, before any app lookup', async () => {
      mockVerify.mockResolvedValue(false);

      await expect(service.register(baseDto)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(mockPrisma.saApp.findUnique).not.toHaveBeenCalled();
      expect(mockSignUpEmail).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('calls TurnstileService.verify with the dto token', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);

      await expect(service.register(baseDto)).rejects.toBeInstanceOf(NotFoundException);
      expect(mockVerify).toHaveBeenCalledWith('valid-captcha-token');
    });

    it('throws NotFoundException when appPublicId is not found', async () => {
```

(The third `it` above is the file's existing "throws NotFoundException..." test, left in place — the two new tests are inserted immediately before it, inside the same `describe('register', ...)` block.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/auth-server && npx jest registration/registration.service.spec.ts`
Expected: FAIL — `TypeError: Cannot read properties of undefined (reading 'verify')` or a TS error, since `RegistrationService` doesn't yet depend on `TurnstileService` and `RegisterDto` doesn't have `turnstileToken`.

- [ ] **Step 3: Add `turnstileToken` to the DTO**

In `apps/auth-server/src/registration/register.dto.ts`, add after the `appPublicId` field (line 24):

```typescript
  @IsString() @MinLength(1) appPublicId!: string;
  @IsString() @MinLength(1) turnstileToken!: string;
```

- [ ] **Step 4: Wire `TurnstileService` into `RegistrationService.register()`**

In `apps/auth-server/src/registration/registration.service.ts`, update the import line (line 1) to add `UnprocessableEntityException`:

```typescript
import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
```

Add an import for `TurnstileService` after the `RegisterDto` import (line 6):

```typescript
import { RegisterDto } from './register.dto';
import { TurnstileService } from './turnstile.service';
```

Update the constructor (line 28):

```typescript
  constructor(
    private readonly sqids: SqidService,
    private readonly turnstile: TurnstileService,
  ) {}
```

Insert a new first step at the top of `register()` (before the existing `// 1. Resolve the app` comment on line 31):

```typescript
  async register(dto: RegisterDto): Promise<{ ok: true; orgPublicId: string }> {
    // 0. Verify the captcha before any app lookup or DB work
    const captchaOk = await this.turnstile.verify(dto.turnstileToken);
    if (!captchaOk) {
      throw new UnprocessableEntityException('captcha verification failed');
    }

    // 1. Resolve the app — 404 if unknown
```

- [ ] **Step 5: Register `TurnstileService` in the module**

In `apps/auth-server/src/registration/registration.module.ts`, add the import and provider:

```typescript
import { Module } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';
import { RateLimitGuard, AppLookupRateLimitGuard } from './rate-limit.guard';
import { TurnstileService } from './turnstile.service';

/**
 * SqidService and LoggerService are provided globally via CommonModule
 * so we don't need to re-import them here.
 */
@Module({
  controllers: [RegistrationController],
  providers: [RegistrationService, RateLimitGuard, AppLookupRateLimitGuard, TurnstileService],
})
export class RegistrationModule {}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/auth-server && npx jest registration/`
Expected: PASS — all files under `registration/` (`turnstile.service.spec.ts`, `registration.service.spec.ts`, `register.dto.spec.ts`, `registration.controller.spec.ts`, `rate-limit.guard.spec.ts`) pass. `register.dto.spec.ts` and `registration.controller.spec.ts` are unaffected by this change (they don't construct a full `RegisterDto` needing `turnstileToken` for password-policy/controller-passthrough assertions) but re-run them here to confirm.

- [ ] **Step 7: Commit**

```bash
git add apps/auth-server/src/registration/register.dto.ts apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.module.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(auth-server): verify signup captcha before app lookup in RegistrationService"
```

---

### Task 3: Forward the captcha token through `apps/admin`'s `registerAction`

**Files:**
- Modify: `apps/admin/app/signup/actions.ts`
- Modify: `apps/admin/app/signup/__tests__/actions.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `POST /api/register` now requires `turnstileToken` in the body and returns 422 on captcha failure (Task 2).
- Produces: `RegisterInput.turnstileToken: string` (required), `registerAction(...)` returns `{ error: 'captchaFailed' }` on a 422. Consumed by Task 4 (`signup-form.tsx`).

- [ ] **Step 1: Write the failing tests**

In `apps/admin/app/signup/__tests__/actions.test.ts`, update the `INPUT` fixture (currently lines 12–19):

```typescript
const INPUT = {
  clientId: 'sq_1',
  firstName: 'Alice',
  lastName: 'Wonder',
  companyName: 'Acme Inc',
  email: 'alice@example.com',
  password: 'SecurePass1!',
  turnstileToken: 'test-captcha-token',
}
```

Update the `body: JSON.stringify({...})` assertion inside the `'posts the mapped fields to /api/register'` test to include `turnstileToken: INPUT.turnstileToken`:

```typescript
        body: JSON.stringify({
          email: INPUT.email,
          password: INPUT.password,
          firstName: INPUT.firstName,
          lastName: INPUT.lastName,
          companyName: INPUT.companyName,
          appPublicId: INPUT.clientId,
          turnstileToken: INPUT.turnstileToken,
        }),
```

Add `[422, 'captchaFailed']` to the `it.each` table (currently the 5-row array starting `[404, 'appNotFound'], ...`):

```typescript
  it.each([
    [404, 'appNotFound'],
    [409, 'emailTaken'],
    [422, 'captchaFailed'],
    [429, 'tooManyRequests'],
    [400, 'validationError'],
    [500, 'validationError'],
  ])('maps upstream %d to %s', async (status, expected) => {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/admin && npx jest signup/__tests__/actions.test.ts`
Expected: FAIL — the "posts the mapped fields" body assertion mismatches (no `turnstileToken` in the actual POST body yet) and the 422 case resolves to `validationError` instead of `captchaFailed`.

- [ ] **Step 3: Implement the change**

In `apps/admin/app/signup/actions.ts`, update `RegisterInput` (currently lines 8–15):

```typescript
export interface RegisterInput {
  clientId: string
  firstName: string
  lastName: string
  companyName: string
  email: string
  password: string
  turnstileToken: string
}
```

Update the POST body (currently lines 26–33):

```typescript
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        companyName: input.companyName,
        appPublicId: input.clientId,
        turnstileToken: input.turnstileToken,
      }),
```

Add the 422 mapping right after the existing 409 line (currently line 42):

```typescript
  if (res.status === 409) return { error: 'emailTaken' }
  if (res.status === 422) return { error: 'captchaFailed' }
  if (res.status === 429) return { error: 'tooManyRequests' }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/admin && npx jest signup/__tests__/actions.test.ts`
Expected: PASS (all cases, including the new 422 row)

- [ ] **Step 5: Document the public site-key env var**

Append to `.env.example`, immediately after the `TURNSTILE_SECRET_KEY` block added in Task 1:

```
# Public site key for apps/admin's /signup Turnstile widget — inlined into
# the client bundle by the NEXT_PUBLIC_ prefix, safe to expose.
# For local dev/test/CI, use Cloudflare's documented always-pass test site
# key: 1x00000000000000000000AA (paired with TURNSTILE_SECRET_KEY above).
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/app/signup/actions.ts apps/admin/app/signup/__tests__/actions.test.ts .env.example
git commit -m "feat(admin): forward signup captcha token and map 422 to captchaFailed"
```

---

### Task 4: Turnstile widget in the signup form

**Files:**
- Modify: `apps/admin/package.json` (new dependency)
- Modify: `apps/admin/app/signup/signup-form.tsx`
- Modify: `apps/admin/app/signup/__tests__/signup-form.test.tsx`
- Modify: `apps/admin/messages/en.json`

**Interfaces:**
- Consumes: `registerAction(input: RegisterInput)` where `RegisterInput.turnstileToken: string` is required (Task 3).
- Produces: none consumed by later tasks — this is the last task.

- [ ] **Step 1: Add the dependency**

In `apps/admin/package.json`, add to `dependencies` (alphabetically, after `@sassy-auth/ui`):

```json
    "@marsidev/react-turnstile": "^1.1.0",
```

Run: `pnpm install` (from the repo root)
Expected: lockfile updates, `apps/admin/node_modules/@marsidev/react-turnstile` exists.

- [ ] **Step 2: Write the failing tests**

In `apps/admin/app/signup/__tests__/signup-form.test.tsx`, add a mock for the Turnstile widget right after the existing `next-intl` mock (after line 11):

```typescript
jest.mock('@marsidev/react-turnstile', () => ({
  Turnstile: ({ onSuccess }: { onSuccess: (token: string) => void }) => (
    <button type="button" data-testid="mock-turnstile-success" onClick={() => onSuccess('test-captcha-token')}>
      Complete captcha
    </button>
  ),
}))
```

Add a `completeCaptcha` helper right after the existing `fillValidForm` function:

```typescript
function completeCaptcha() {
  fireEvent.click(screen.getByTestId('mock-turnstile-success'))
}
```

Add `completeCaptcha()` before the `fireEvent.click(screen.getByText('signup.submit'))` line in these four existing tests (leave everything else in each test unchanged):
- `'calls registerAction with the mapped fields on valid submit'`
- `'shows a translated error returned by registerAction'`
- `'shows an error and clears the loading state when registerAction rejects'`
- `'shows the success state and a link to /login after a successful submit'`
- `'carries next forward into the post-signup login link'`

Update the assertion in `'calls registerAction with the mapped fields on valid submit'` to include `turnstileToken`:

```typescript
    await waitFor(() =>
      expect(mockRegisterAction).toHaveBeenCalledWith({
        clientId: 'sq_1',
        firstName: 'Alice',
        lastName: 'Wonder',
        companyName: 'Acme Inc',
        email: 'alice@example.com',
        password: 'SecurePass1!',
        turnstileToken: 'test-captcha-token',
      }),
    )
```

Add a new test at the end of the `describe('SignupForm', ...)` block, before its closing `})`:

```typescript
  it('shows a captchaRequired error and does not submit when the captcha has not been completed', async () => {
    render(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.captchaRequired'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/admin && npx jest signup/__tests__/signup-form.test.tsx`
Expected: FAIL — `screen.getByTestId('mock-turnstile-success')` not found (widget not rendered yet), and the new `captchaRequired` test fails because no such check exists yet in `handleSubmit`.

- [ ] **Step 4: Implement the widget and client-side validation**

In `apps/admin/app/signup/signup-form.tsx`, add the import after the `Button` import (line 6):

```typescript
import { Button } from '@sassy-auth/ui'
import { Turnstile } from '@marsidev/react-turnstile'
import { registerAction } from './actions'
```

Add captcha state alongside the other `useState` declarations (after `success`, currently line 32):

```typescript
  const [success, setSuccess] = React.useState(false)
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null)
```

Add the captcha-required guard in `handleSubmit`, after the password-complexity check and before `setError(null)` (currently lines 38–42):

```typescript
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password)) {
      setError(t('signup.errors.passwordComplexity'))
      return
    }
    if (!captchaToken) {
      setError(t('signup.errors.captchaRequired'))
      return
    }
    setError(null)
```

Update the `registerAction` call (currently line 45) to include `turnstileToken`:

```typescript
      const result = await registerAction({ clientId, firstName, lastName, companyName, email, password, turnstileToken: captchaToken })
```

Render the widget above the submit button, after the error message block and before the `<Button type="submit" ...>` (currently right before line 146):

```typescript
      {error && <p data-testid="signup-error" className="text-label-md text-[var(--destructive)]">{error}</p>}
      <Turnstile
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
        onSuccess={setCaptchaToken}
        onExpire={() => setCaptchaToken(null)}
      />
      <Button type="submit" className="w-full" loading={submitting}>
```

- [ ] **Step 5: Add the new i18n key**

In `apps/admin/messages/en.json`, add `captchaRequired` to the `signup.errors` object (alongside the existing `passwordComplexity` key):

```json
      "passwordComplexity": "Password must contain an uppercase letter, a lowercase letter, and a digit.",
      "captchaRequired": "Please complete the captcha before submitting.",
      "captchaFailed": "We couldn't verify you're not a robot. Please try the captcha again.",
```

Add `'captchaFailed'` to the `KNOWN_ERRORS` array in `signup-form.tsx` (currently lines 14–20):

```typescript
const KNOWN_ERRORS = [
  'appNotFound',
  'emailTaken',
  'captchaFailed',
  'tooManyRequests',
  'serverUnavailable',
  'validationError',
] as const
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/admin && npx jest signup/__tests__/signup-form.test.tsx`
Expected: PASS (all tests, including the new `captchaRequired` test)

Then run the full admin suite to confirm nothing else regressed:

Run: `cd apps/admin && npx jest`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/admin/package.json pnpm-lock.yaml apps/admin/app/signup/signup-form.tsx apps/admin/app/signup/__tests__/signup-form.test.tsx apps/admin/messages/en.json
git commit -m "feat(admin): render Turnstile widget on signup form and require it before submit"
```

---

## After all tasks

Run the full workspace test suites once more from the repo root to confirm the whole change set is green together:

```bash
cd apps/auth-server && npx jest
cd ../admin && npx jest
```

Manually verify in a browser (dev servers running, `TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY` set to Cloudflare's test keypair from the Global Constraints section): load `/signup?client_id=<a real app's public id>`, confirm the widget renders, confirm submitting before completing it shows `captchaRequired`, and confirm a full valid submission (with the always-pass test keys) succeeds.
