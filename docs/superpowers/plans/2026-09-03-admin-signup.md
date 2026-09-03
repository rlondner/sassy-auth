# Admin Console Self-Serve Signup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `/signup` page to `apps/admin` that creates a new org +
admin user via the existing `POST /api/register` endpoint, fixing the
first/last-name gap in `RegistrationService` along the way and adding a link
from `/login`.

**Architecture:** Backend (`apps/auth-server`): extend `RegisterDto` with
`firstName`/`lastName`, wire them into `RegistrationService.register()`, and
add a public `GET /api/register/app?appPublicId=` name lookup. Frontend
(`apps/admin`): a new `/signup` route (page + client form + server action)
following the existing `/accept-invite` and `/reset-password` structure, plus
a conditional signup link on the login form.

**Tech Stack:** NestJS + Prisma + class-validator (auth-server); Next.js App
Router (server components + server actions) + next-intl + `@sassy-auth/ui`
(admin), Jest + Testing Library for tests.

**Design doc:** `docs/superpowers/specs/2026-09-03-admin-signup-design.md`

---

### Task 1: `RegisterDto` gains `firstName`/`lastName`

**Files:**
- Modify: `apps/auth-server/src/registration/register.dto.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts` (fixture only, this task)

- [ ] **Step 1: Update the shared test fixture to include the new fields**

In `registration.service.spec.ts`, change `baseDto`:

```ts
const baseDto: RegisterDto = {
  email: 'alice@example.com',
  password: 'password123',
  firstName: 'Alice',
  lastName: 'Wonder',
  companyName: 'Acme Inc',
  appPublicId: 'sq_1',
};
```

This alone will fail to compile once we touch the DTO, which is expected —
Step 2 makes it type-check.

- [ ] **Step 2: Add the fields to the DTO**

In `register.dto.ts`:

```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsString() @MinLength(1) companyName!: string;
  @IsString() @MinLength(1) appPublicId!: string;
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/auth-server && npx tsc --noEmit`
Expected: no new errors from `register.dto.ts` or `registration.service.spec.ts`
(the service itself doesn't reference the new fields yet, so this should
already pass — `registration.service.ts` still only reads `dto.companyName`,
which remains valid).

- [ ] **Step 4: Commit**

```bash
git add apps/auth-server/src/registration/register.dto.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "feat(registration): add firstName/lastName to RegisterDto"
```

---

### Task 2: `RegistrationService` uses real first/last name, not the company name

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts:38-40,66-81`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`

- [ ] **Step 1: Update the happy-path test's expectations first (failing test)**

In `registration.service.spec.ts`, in the `'happy path'` test, change the two
assertions that currently reference `dto.companyName` for identity fields:

```ts
      expect(mockSignUpEmail).toHaveBeenCalledWith({
        body: { email: baseDto.email, password: baseDto.password, name: 'Alice Wonder' },
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.saOrg.create).toHaveBeenCalledWith({
        data: { publicId: expect.stringMatching(/^pending-/), name: baseDto.companyName, appId: appRow.id, isPlatform: false },
      });
      expect(mockPrisma.saOrg.update).toHaveBeenCalledWith({
        where: { id: draftOrgRow.id },
        data: { publicId: 'sq_10' },
      });
      expect(mockPrisma.saUser.create).toHaveBeenCalledWith({
        data: {
          publicId: baUserId.slice(0, 12),
          betterAuthUserId: baUserId,
          orgId: finalOrgRow.id,
          firstName: baseDto.firstName,
          lastName: baseDto.lastName,
          status: 'active',
        },
      });
```

(Only the `mockSignUpEmail` body's `name` and the `saUser.create` data's
`firstName`/`lastName` changed — the org-related assertions stay as they are,
since the org is still named after `companyName`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts -t "happy path"`
Expected: FAIL — `mockSignUpEmail` was called with `name: 'Acme Inc'`, not
`'Alice Wonder'`; `saUser.create` was called with `firstName: 'Acme Inc'`,
`lastName: ''`.

- [ ] **Step 3: Update the service**

In `registration.service.ts`, change the `signUpEmail` call:

```ts
      const signUp = await auth.api.signUpEmail({
        body: { email: dto.email, password: dto.password, name: `${dto.firstName} ${dto.lastName}`.trim() },
      });
```

And the `saUser.create` call inside the transaction:

```ts
        await tx.saUser.create({
          data: {
            publicId: baUserId.slice(0, 12),
            betterAuthUserId: baUserId,
            orgId: created.id,
            firstName: dto.firstName,
            lastName: dto.lastName,
            status: 'active',
          },
        });
```

- [ ] **Step 4: Run the full registration service test file**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts`
Expected: PASS (all cases, including the compensation and duplicate-email
tests, which don't assert on `firstName`/`lastName`/`name` and are unaffected).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.service.spec.ts
git commit -m "fix(registration): use real first/last name instead of company name as user identity"
```

---

### Task 3: Public app-name lookup for the signup page

**Files:**
- Modify: `apps/auth-server/src/registration/registration.service.ts`
- Modify: `apps/auth-server/src/registration/registration.controller.ts`
- Modify: `apps/auth-server/src/registration/registration.service.spec.ts`
- Create: `apps/auth-server/src/registration/registration.controller.spec.ts`

- [ ] **Step 1: Write the failing service test**

Add to `registration.service.spec.ts`, as a new top-level `describe` after the
existing `describe('register', ...)` block (still inside the outer
`describe('RegistrationService', ...)`, before its closing brace):

```ts
  describe('getAppName', () => {
    it('returns the app name for a known appPublicId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue({ name: 'MyApp' });

      await expect(service.getAppName('sq_1')).resolves.toEqual({ name: 'MyApp' });
      expect(mockPrisma.saApp.findUnique).toHaveBeenCalledWith({
        where: { publicId: 'sq_1' },
        select: { name: true },
      });
    });

    it('throws NotFoundException for an unknown appPublicId', async () => {
      mockPrisma.saApp.findUnique.mockResolvedValue(null);

      await expect(service.getAppName('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for an empty appPublicId without querying the database', async () => {
      await expect(service.getAppName('')).rejects.toBeInstanceOf(NotFoundException);
      expect(mockPrisma.saApp.findUnique).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts -t "getAppName"`
Expected: FAIL — `service.getAppName` is not a function.

- [ ] **Step 3: Implement `getAppName` on the service**

In `registration.service.ts`, add a new public method (below `register()`,
inside the `RegistrationService` class):

```ts
  async getAppName(appPublicId: string): Promise<{ name: string }> {
    if (!appPublicId) throw new NotFoundException('App not found');
    const app = await prisma.saApp.findUnique({
      where: { publicId: appPublicId },
      select: { name: true },
    });
    if (!app) throw new NotFoundException('App not found');
    return { name: app.name };
  }
```

- [ ] **Step 4: Run the service test file**

Run: `cd apps/auth-server && npx jest src/registration/registration.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the controller test (new file)**

Create `apps/auth-server/src/registration/registration.controller.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';

describe('RegistrationController', () => {
  let controller: RegistrationController;
  const mockService = {
    register: jest.fn(),
    getAppName: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [RegistrationController],
      providers: [{ provide: RegistrationService, useValue: mockService }],
    }).compile();
    controller = module.get(RegistrationController);
  });

  describe('getAppName', () => {
    it('delegates to the service with the query param', async () => {
      mockService.getAppName.mockResolvedValue({ name: 'MyApp' });

      const result = await controller.getAppName('sq_1');

      expect(mockService.getAppName).toHaveBeenCalledWith('sq_1');
      expect(result).toEqual({ name: 'MyApp' });
    });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd apps/auth-server && npx jest src/registration/registration.controller.spec.ts`
Expected: FAIL — `controller.getAppName` is not a function (the route doesn't
exist yet).

- [ ] **Step 7: Add the route to the controller**

In `registration.controller.ts`, add `Get` and `Query` to the imports and add
the new handler:

```ts
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { RegisterDto } from './register.dto';
import { RateLimitGuard } from './rate-limit.guard';

/**
 * Public (no BetterAuthGuard) self-serve signup endpoint.
 *
 * The NestJS global prefix is 'api', so the effective route is:
 *   POST /api/register
 */
@Controller('register')
export class RegistrationController {
  constructor(private readonly service: RegistrationService) {}

  @Post()
  @UseGuards(RateLimitGuard)
  register(@Body() dto: RegisterDto) {
    return this.service.register(dto);
  }

  /**
   * GET /api/register/app?appPublicId=<id>
   *
   * Public and unauthenticated, mirroring SocialController's public
   * GET /api/social-providers: exposes only an app's display name for a
   * known public id, which is the same class of disclosure as confirming
   * whether a client_id exists at all. Used by the admin console's /signup
   * page to render "Register with {app name}".
   */
  @Get('app')
  getAppName(@Query('appPublicId') appPublicId: string) {
    return this.service.getAppName(appPublicId);
  }
}
```

- [ ] **Step 8: Run the controller test**

Run: `cd apps/auth-server && npx jest src/registration/registration.controller.spec.ts`
Expected: PASS

- [ ] **Step 9: Run the whole registration test suite**

Run: `cd apps/auth-server && npx jest src/registration`
Expected: PASS (all files)

- [ ] **Step 10: Commit**

```bash
git add apps/auth-server/src/registration/registration.service.ts apps/auth-server/src/registration/registration.controller.ts apps/auth-server/src/registration/registration.service.spec.ts apps/auth-server/src/registration/registration.controller.spec.ts
git commit -m "feat(registration): add public app-name lookup for the signup page"
```

---

### Task 4: Admin — signup server action

**Files:**
- Create: `apps/admin/app/signup/actions.ts`
- Create: `apps/admin/app/signup/__tests__/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/app/signup/__tests__/actions.test.ts`:

```ts
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }))
jest.mock('@/lib/auth-origin', () => ({ getForwardedOrigin: jest.fn() }))

import { getForwardedOrigin } from '@/lib/auth-origin'

const mockGetForwardedOrigin = getForwardedOrigin as jest.MockedFunction<any>

function upstream(status: number) {
  return { ok: status >= 200 && status < 300, status } as Response
}

let registerAction: typeof import('../actions').registerAction

const INPUT = {
  clientId: 'sq_1',
  firstName: 'Alice',
  lastName: 'Wonder',
  companyName: 'Acme Inc',
  email: 'alice@example.com',
  password: 'SecurePass1!',
}

beforeEach(async () => {
  jest.clearAllMocks()
  jest.resetModules()
  mockGetForwardedOrigin.mockResolvedValue('https://admin.example.com')
  global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>
  const mod = await import('../actions')
  registerAction = mod.registerAction
})

describe('registerAction', () => {
  it('posts the mapped fields to /api/register', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(201))

    await registerAction(INPUT)

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/register'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: INPUT.email,
          password: INPUT.password,
          firstName: INPUT.firstName,
          lastName: INPUT.lastName,
          companyName: INPUT.companyName,
          appPublicId: INPUT.clientId,
        }),
      }),
    )
  })

  it('returns ok on a 2xx response', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(201))

    await expect(registerAction(INPUT)).resolves.toEqual({ ok: true })
  })

  it.each([
    [404, 'appNotFound'],
    [409, 'emailTaken'],
    [429, 'tooManyRequests'],
    [400, 'validationError'],
    [500, 'validationError'],
  ])('maps upstream %d to %s', async (status, expected) => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue(upstream(status))

    await expect(registerAction(INPUT)).resolves.toEqual({ error: expected })
  })

  it('returns serverUnavailable when the fetch itself rejects', async () => {
    ;(global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(registerAction(INPUT)).resolves.toEqual({ error: 'serverUnavailable' })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx jest app/signup/__tests__/actions.test.ts`
Expected: FAIL — cannot find module `../actions`.

- [ ] **Step 3: Implement the server action**

Create `apps/admin/app/signup/actions.ts`:

```ts
'use server'

import * as Sentry from '@sentry/nextjs'
import { getForwardedOrigin } from '@/lib/auth-origin'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export interface RegisterInput {
  clientId: string
  firstName: string
  lastName: string
  companyName: string
  email: string
  password: string
}

export async function registerAction(
  input: RegisterInput,
): Promise<{ ok: true } | { error: string }> {
  const origin = await getForwardedOrigin()
  let res: Response
  try {
    res = await fetch(`${AUTH_SERVER}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin && { Origin: origin }) },
      body: JSON.stringify({
        email: input.email,
        password: input.password,
        firstName: input.firstName,
        lastName: input.lastName,
        companyName: input.companyName,
        appPublicId: input.clientId,
      }),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'auth', action: 'signup' } })
    return { error: 'serverUnavailable' }
  }

  if (res.ok) return { ok: true }
  if (res.status === 404) return { error: 'appNotFound' }
  if (res.status === 409) return { error: 'emailTaken' }
  if (res.status === 429) return { error: 'tooManyRequests' }
  return { error: 'validationError' }
}
```

- [ ] **Step 4: Run the test**

Run: `cd apps/admin && npx jest app/signup/__tests__/actions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/actions.ts apps/admin/app/signup/__tests__/actions.test.ts
git commit -m "feat(admin): add signup server action"
```

---

### Task 5: Admin — i18n strings for `signup` and `login`

Doing i18n before the form component so the component's translation keys
already exist when its tests run against the real `en.json`.

**Files:**
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

- [ ] **Step 1: Add the `signup` namespace to `en.json`**

Insert after the `"acceptInvite"` block (i.e. right before `"security"`, which
currently follows it at line 527):

```json
  "signup": {
    "title": "Create your account",
    "titleWithApp": "Register with {appName}",
    "subtitle": "Set up your organization to get started.",
    "invalidLink": "This signup link isn't valid. Ask the app you're signing up for a new one.",
    "firstName": "First Name",
    "lastName": "Last Name",
    "companyName": "Company Name",
    "email": "Email Address",
    "password": "Password",
    "confirmPassword": "Confirm Password",
    "submit": "Create account",
    "success": "Account created! You can now sign in.",
    "continueToLogin": "Continue to sign in",
    "backToLogin": "Back to sign in",
    "errors": {
      "passwordMismatch": "Passwords do not match.",
      "passwordTooShort": "Password must be at least 12 characters.",
      "passwordComplexity": "Password must contain an uppercase letter, a lowercase letter, and a digit.",
      "appNotFound": "We couldn't find the app for this signup link.",
      "emailTaken": "An account with this email already exists.",
      "tooManyRequests": "Too many attempts. Please wait a minute and try again.",
      "serverUnavailable": "We could not reach the server. Please try again in a moment.",
      "validationError": "We couldn't create your account. Please check your details and try again."
    }
  },
```

- [ ] **Step 2: Add the signup prompt to `login` in `en.json`**

Inside the `"login"` block, add two keys after `"forgotPassword"` (line 485):

```json
    "forgotPassword": "Forgot password?",
    "signupPrompt": "Don't have an account?",
    "signupLink": "Sign up",
```

- [ ] **Step 3: Mirror both additions in `fr.json`**

Insert after the `"acceptInvite"` block in `fr.json` (right before `"security"`):

```json
  "signup": {
    "title": "Créez votre compte",
    "titleWithApp": "Inscription à {appName}",
    "subtitle": "Configurez votre organisation pour commencer.",
    "invalidLink": "Ce lien d'inscription n'est pas valide. Demandez-en un nouveau à l'application concernée.",
    "firstName": "Prénom",
    "lastName": "Nom",
    "companyName": "Nom de l'entreprise",
    "email": "Adresse e-mail",
    "password": "Mot de passe",
    "confirmPassword": "Confirmer le mot de passe",
    "submit": "Créer le compte",
    "success": "Compte créé ! Vous pouvez maintenant vous connecter.",
    "continueToLogin": "Continuer vers la connexion",
    "backToLogin": "Retour à la connexion",
    "errors": {
      "passwordMismatch": "Les mots de passe ne correspondent pas.",
      "passwordTooShort": "Le mot de passe doit comporter au moins 12 caractères.",
      "passwordComplexity": "Le mot de passe doit contenir une majuscule, une minuscule et un chiffre.",
      "appNotFound": "Nous n'avons pas trouvé l'application pour ce lien d'inscription.",
      "emailTaken": "Un compte existe déjà avec cette adresse e-mail.",
      "tooManyRequests": "Trop de tentatives. Veuillez patienter une minute et réessayer.",
      "serverUnavailable": "Impossible de joindre le serveur. Veuillez réessayer dans un instant.",
      "validationError": "Impossible de créer votre compte. Vérifiez vos informations et réessayez."
    }
  },
```

And in `fr.json`'s `"login"` block, after `"forgotPassword": "Mot de passe oublié ?",` (line 485):

```json
    "forgotPassword": "Mot de passe oublié ?",
    "signupPrompt": "Vous n'avez pas de compte ?",
    "signupLink": "S'inscrire",
```

- [ ] **Step 4: Verify both files are still valid JSON**

Run: `cd apps/admin && node -e "JSON.parse(require('fs').readFileSync('messages/en.json'))" && node -e "JSON.parse(require('fs').readFileSync('messages/fr.json'))"`
Expected: no output (no parse errors).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add signup i18n strings"
```

---

### Task 6: Admin — `SignupForm` component

**Files:**
- Create: `apps/admin/app/signup/signup-form.tsx`
- Create: `apps/admin/app/signup/__tests__/signup-form.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/admin/app/signup/__tests__/signup-form.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { SignupForm } from '../signup-form'

jest.mock('../actions', () => ({
  registerAction: jest.fn(),
}))

import { registerAction } from '../actions'
const mockRegisterAction = registerAction as jest.MockedFunction<any>

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('signup.firstName'), { target: { value: 'Alice' } })
  fireEvent.change(screen.getByLabelText('signup.lastName'), { target: { value: 'Wonder' } })
  fireEvent.change(screen.getByLabelText('signup.companyName'), { target: { value: 'Acme Inc' } })
  fireEvent.change(screen.getByLabelText('signup.email'), { target: { value: 'alice@example.com' } })
  fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'SecurePass1!' } })
  fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'SecurePass1!' } })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRegisterAction.mockResolvedValue({ ok: true })
})

describe('SignupForm', () => {
  it('renders all fields', () => {
    wrap(<SignupForm clientId="sq_1" next="" />)
    expect(screen.getByLabelText('signup.firstName')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.lastName')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.companyName')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.email')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.password')).toBeInTheDocument()
    expect(screen.getByLabelText('signup.confirmPassword')).toBeInTheDocument()
  })

  it('shows an error when passwords do not match, without submitting', async () => {
    wrap(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'Different1!' } })
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.passwordMismatch'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('shows an error for a password under 12 characters', async () => {
    wrap(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'Short1!' } })
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'Short1!' } })
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.passwordTooShort'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('shows an error for a password missing complexity', async () => {
    wrap(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.change(screen.getByLabelText('signup.password'), { target: { value: 'lowercaseonly1' } })
    fireEvent.change(screen.getByLabelText('signup.confirmPassword'), { target: { value: 'lowercaseonly1' } })
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.passwordComplexity'),
    )
    expect(mockRegisterAction).not.toHaveBeenCalled()
  })

  it('calls registerAction with the mapped fields on valid submit', async () => {
    wrap(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(mockRegisterAction).toHaveBeenCalledWith({
        clientId: 'sq_1',
        firstName: 'Alice',
        lastName: 'Wonder',
        companyName: 'Acme Inc',
        email: 'alice@example.com',
        password: 'SecurePass1!',
      }),
    )
  })

  it('shows a translated error returned by registerAction', async () => {
    mockRegisterAction.mockResolvedValue({ error: 'emailTaken' })
    wrap(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() =>
      expect(screen.getByTestId('signup-error')).toHaveTextContent('signup.errors.emailTaken'),
    )
  })

  it('shows the success state and a link to /login after a successful submit', async () => {
    wrap(<SignupForm clientId="sq_1" next="" />)
    fillValidForm()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() => expect(screen.getByText('signup.success')).toBeInTheDocument())
    expect(screen.getByText('signup.continueToLogin').closest('a')).toHaveAttribute('href', '/login')
  })

  it('carries next forward into the post-signup login link', async () => {
    wrap(<SignupForm clientId="sq_1" next="/orgs" />)
    fillValidForm()
    fireEvent.click(screen.getByText('signup.submit'))

    await waitFor(() => expect(screen.getByText('signup.success')).toBeInTheDocument())
    expect(screen.getByText('signup.continueToLogin').closest('a')).toHaveAttribute(
      'href',
      '/login?next=%2Forgs',
    )
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx jest app/signup/__tests__/signup-form.test.tsx`
Expected: FAIL — cannot find module `../signup-form`.

- [ ] **Step 3: Implement the component**

Create `apps/admin/app/signup/signup-form.tsx`:

```tsx
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@sassy-auth/ui'
import { registerAction } from './actions'

interface SignupFormProps {
  clientId: string
  next: string
}

const KNOWN_ERRORS = [
  'appNotFound',
  'emailTaken',
  'tooManyRequests',
  'serverUnavailable',
  'validationError',
] as const

export function SignupForm({ clientId, next }: SignupFormProps) {
  const t = useTranslations('signup')
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [companyName, setCompanyName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError(t('errors.passwordMismatch')); return }
    if (password.length < 12) { setError(t('errors.passwordTooShort')); return }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password)) {
      setError(t('errors.passwordComplexity'))
      return
    }
    setError(null)
    setSubmitting(true)
    const result = await registerAction({ clientId, firstName, lastName, companyName, email, password })
    setSubmitting(false)
    if ('error' in result) {
      const key = (KNOWN_ERRORS as readonly string[]).includes(result.error) ? result.error : 'validationError'
      setError(t(`errors.${key as (typeof KNOWN_ERRORS)[number]}`))
      return
    }
    setSuccess(true)
  }

  if (success) {
    const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'
    return (
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <span className="material-symbols-outlined text-[48px] text-[var(--primary)]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        </div>
        <p className="text-body-md text-[var(--foreground)]">{t('success')}</p>
        <div className="mt-4">
          <Link href={loginHref} className="text-label-md text-[var(--primary)] hover:underline">
            {t('continueToLogin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="firstName" className="text-label-md font-semibold">{t('firstName')}</label>
          <input
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lastName" className="text-label-md font-semibold">{t('lastName')}</label>
          <input
            id="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="companyName" className="text-label-md font-semibold">{t('companyName')}</label>
        <input
          id="companyName"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-label-md font-semibold">{t('email')}</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-label-md font-semibold">{t('password')}</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={12}
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="confirm-password" className="text-label-md font-semibold">{t('confirmPassword')}</label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          className="flex h-9 rounded border border-[var(--border)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        />
      </div>
      {error && <p data-testid="signup-error" className="text-label-md text-[var(--destructive)]">{error}</p>}
      <Button type="submit" className="w-full" loading={submitting}>
        {t('submit')}
      </Button>
    </form>
  )
}
```

Note: `htmlFor="confirm-password"` pairs with `id="confirm-password"` for the
confirm-password field, matching `screen.getByLabelText('signup.confirmPassword')`
in the test — the translation key name (`confirmPassword`) and the DOM id
(`confirm-password`) don't need to match each other, only `htmlFor`/`id` do.

- [ ] **Step 4: Run the test**

Run: `cd apps/admin && npx jest app/signup/__tests__/signup-form.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/signup/signup-form.tsx apps/admin/app/signup/__tests__/signup-form.test.tsx
git commit -m "feat(admin): add SignupForm component"
```

---

### Task 7: Admin — `/signup` page

**Files:**
- Create: `apps/admin/app/signup/page.tsx`

No new test file for this task: `page.tsx` is a thin server component wiring
together `searchParams`, a `fetch` to the new endpoint, and `<SignupForm>`
(already tested in Task 6). It's covered by the manual verification in
Task 9. This matches the codebase's existing convention — `login/page.tsx`,
`reset-password/page.tsx`, and `accept-invite/page.tsx` have no dedicated
page-level test files either; their logic-bearing pieces (`actions.ts`, the
form components) are what's unit-tested.

- [ ] **Step 1: Create the page**

Create `apps/admin/app/signup/page.tsx`:

```tsx
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { SignupForm } from './signup-form'

const AUTH_SERVER = process.env.AUTH_SERVER_URL ?? 'http://localhost:3000'

export const dynamic = 'force-dynamic'

async function fetchAppName(clientId: string): Promise<string | null> {
  try {
    const res = await fetch(`${AUTH_SERVER}/api/register/app?appPublicId=${encodeURIComponent(clientId)}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const body = (await res.json()) as { name?: string }
    return typeof body.name === 'string' ? body.name : null
  } catch {
    return null
  }
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; next?: string }>
}) {
  const { client_id: clientId, next } = await searchParams
  const t = await getTranslations('signup')

  if (!clientId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] p-6">
        <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm text-center">
          <span className="material-symbols-outlined text-[48px] text-[var(--destructive)]">error</span>
          <p className="mt-4 text-body-md text-[var(--foreground)]">{t('invalidLink')}</p>
        </div>
      </div>
    )
  }

  const appName = await fetchAppName(clientId)
  const nextSafe = next ?? ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">
            {appName ? t('titleWithApp', { appName }) : t('title')}
          </h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('subtitle')}</p>
        </div>
        <SignupForm clientId={clientId} next={nextSafe} />
        <div className="mt-4 text-center">
          <Link
            href={nextSafe ? `/login?next=${encodeURIComponent(nextSafe)}` : '/login'}
            className="text-label-md text-[var(--primary)] hover:underline"
          >
            {t('backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/app/signup/page.tsx
git commit -m "feat(admin): add /signup page"
```

---

### Task 8: Admin — signup link on the login page

**Files:**
- Modify: `apps/admin/app/login/login-form.tsx`
- Modify: `apps/admin/app/login/__tests__/login-forms.test.tsx`

- [ ] **Step 1: Write the failing tests**

In `login-forms.test.tsx`, add two new cases inside `describe('LoginForm', ...)`
(anywhere after the existing `it('does not show an error before anything is submitted', ...)` case, before its closing `})`):

```ts
  it('shows a signup link when next carries a client_id', () => {
    wrap(<LoginForm next="/api/token/oauth/authorize?client_id=sq_1&redirect_uri=x" authServerUrl="https://auth.test" />)

    const link = screen.getByText(messages.login.signupLink).closest('a')
    expect(link).toHaveAttribute(
      'href',
      '/signup?client_id=sq_1&next=%2Fapi%2Ftoken%2Foauth%2Fauthorize%3Fclient_id%3Dsq_1%26redirect_uri%3Dx',
    )
  })

  it('hides the signup link when next has no client_id', () => {
    wrap(<LoginForm next="/orgs" authServerUrl="https://auth.test" />)

    expect(screen.queryByText(messages.login.signupLink)).not.toBeInTheDocument()
  })

  it('hides the signup link when there is no next at all', () => {
    wrap(<LoginForm next="" authServerUrl="https://auth.test" />)

    expect(screen.queryByText(messages.login.signupLink)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/admin && npx jest app/login/__tests__/login-forms.test.tsx -t "signup link"`
Expected: FAIL — `messages.login.signupLink` text is not found in the document
(the link doesn't exist yet).

- [ ] **Step 3: Add the link to `login-form.tsx`**

Add a helper function above the `LoginForm` component and render the
conditional link inside the card, after the closing `</form>` tag:

```tsx
'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@sassy-auth/ui'
import { signIn } from './actions'
import { SocialButtons } from './social-buttons'

/**
 * `next` may be a relative or absolute authorize URL carrying `client_id` —
 * the same shape `applyPerAppTrustCookie` (app/login/actions.ts) already
 * parses for trust-day lookups. A placeholder base lets a relative `next`
 * parse without throwing.
 */
function clientIdFromNext(next: string): string | null {
  if (!next) return null
  try {
    return new URL(next, 'http://placeholder.invalid').searchParams.get('client_id')
  } catch {
    return null
  }
}

export function LoginForm({
  next,
  providers = [],
  authServerUrl,
}: {
  next: string
  providers?: string[]
  authServerUrl: string
}) {
  const t = useTranslations('login')
  const router = useRouter()
  const clientId = clientIdFromNext(next)

  const [state, formAction, isPending] = useActionState(
    async (
      _prev: { error?: string } | { twoFactor: true },
      formData: FormData,
    ): Promise<{ error?: string } | { twoFactor: true }> => {
      formData.set('next', next)
      const result = await signIn(formData)
      if ('twoFactor' in result && result.twoFactor) {
        router.push(`/login/two-factor${next ? `?next=${encodeURIComponent(next)}` : ''}`)
      }
      return result
    },
    {} as { error?: string } | { twoFactor: true },
  )

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--card)] p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-headline-sm text-[var(--foreground)]">{t('title')}</h1>
          <p className="mt-1 text-body-sm text-[var(--muted-foreground)]">{t('subtitle')}</p>
        </div>

        <SocialButtons providers={providers} next={next} authServerUrl={authServerUrl} />

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next} />

          <div className="flex flex-col gap-1.5">
            <label className="text-label-md font-semibold" htmlFor="email">{t('email')}</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-label-md font-semibold" htmlFor="password">{t('password')}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="flex h-9 w-full rounded border border-[var(--border)] bg-[var(--card)] px-3 text-body-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            />
          </div>

          {'error' in state && state.error && (
            <p data-testid="login-error" className="text-label-md text-[var(--destructive)]">
              {state.error === 'invalidCredentials' ||
              state.error === 'inactive' ||
              state.error === 'serverUnavailable' ||
              state.error === 'tooManyRequests'
                ? t(`error.${state.error}`)
                : state.error}
            </p>
          )}

          <Link href="/forgot-password" className="text-label-md text-[var(--primary)] hover:underline self-end">
            {t('forgotPassword')}
          </Link>
          <Link
            href={next ? `/login/code?next=${encodeURIComponent(next)}` : '/login/code'}
            className="text-label-md text-[var(--primary)] hover:underline self-end"
          >
            {t('useCode')}
          </Link>

          <Button type="submit" className="w-full" loading={isPending}>
            {t('submit')}
          </Button>
        </form>

        {clientId && (
          <p className="mt-4 text-center text-label-md text-[var(--muted-foreground)]">
            {t('signupPrompt')}{' '}
            <Link
              href={`/signup?client_id=${encodeURIComponent(clientId)}${next ? `&next=${encodeURIComponent(next)}` : ''}`}
              className="text-[var(--primary)] hover:underline"
            >
              {t('signupLink')}
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the full login-forms test file**

Run: `cd apps/admin && npx jest app/login/__tests__/login-forms.test.tsx`
Expected: PASS (all cases, including the pre-existing `LoginForm`,
`LoginOtpForm`, and `TwoFactorForm` suites — unaffected by this change).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/app/login/login-form.tsx apps/admin/app/login/__tests__/login-forms.test.tsx
git commit -m "feat(admin): add signup link to the login page"
```

---

### Task 9: Full test suite + manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Run the full auth-server test suite**

Run: `cd apps/auth-server && npx jest`
Expected: PASS, no regressions outside `src/registration/`.

- [ ] **Step 2: Run the full admin test suite**

Run: `cd apps/admin && npx jest`
Expected: PASS, no regressions outside `app/signup/` and `app/login/`.

- [ ] **Step 3: Typecheck both apps**

Run: `cd apps/auth-server && npx tsc --noEmit`
Run: `cd apps/admin && npx tsc --noEmit`
Expected: no errors in either.

- [ ] **Step 4: Manual smoke test — start both dev servers**

Run (in `apps/auth-server`): `npm run start:dev` (or the project's usual dev
command — check `package.json` `scripts` if `start:dev` doesn't exist)
Run (in `apps/admin`, separate terminal): `npm run dev`

- [ ] **Step 5: Manual smoke test — invalid link**

Visit `http://localhost:3001/signup` (no `client_id`).
Expected: "This signup link isn't valid…" message, no form.

- [ ] **Step 6: Manual smoke test — find a real `appPublicId`**

Log into the admin console as an existing operator, open the Apps page, and
copy the `publicId` of any existing app (or seed one via
`apps/auth-server`'s `npm run seed` if none exist).

- [ ] **Step 7: Manual smoke test — happy path**

Visit `http://localhost:3001/signup?client_id=<the publicId from Step 6>`.
Expected: heading reads "Register with {app name}". Fill in first name, last
name, company name, a fresh email, and a valid password (12+ chars, upper,
lower, digit) twice. Submit.
Expected: success message and a "Continue to sign in" link to `/login`.
Verify in the database (or via the admin's Users/Orgs pages once logged in
as an operator who can see the new org) that a new `SaOrg` and `SaUser` were
created, and that the `SaUser`'s `firstName`/`lastName` match what was typed
— not the company name.

- [ ] **Step 8: Manual smoke test — duplicate email**

Repeat Step 7 with the same email.
Expected: "An account with this email already exists." error, no new org
created.

- [ ] **Step 9: Manual smoke test — login page link**

Navigate to an OAuth `/authorize` flow for the same app so you land on
`/login?next=...&client_id=...` (or manually visit
`http://localhost:3001/login?next=%2Fapi%2Ftoken%2Foauth%2Fauthorize%3Fclient_id%3D<id>`).
Expected: "Don't have an account? Sign up" link appears and points to
`/signup?client_id=<id>&next=...`. Visit `/login` with no `next` at all and
confirm the link is absent.

No commit for this task — it's verification, not a code change. If any step
fails, fix the underlying code in the relevant earlier task (re-run that
task's tests after the fix) rather than patching around it here.
