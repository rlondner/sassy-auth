# EmailService Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable email-sending capability to `auth-server` (Console / SMTP / Resend transports) that the invitation and password-reset features depend on.

**Architecture:** A NestJS `EmailModule` provides an `EmailService.send(...)`. The concrete transport is chosen once at startup by env priority (Resend > SMTP > Console) behind an injected token, so feature code never knows which transport is active and tests inject a fake. Sends never throw into the caller — failures are logged and returned as `{ sent: false }`.

**Tech Stack:** NestJS, TypeScript, Jest, `nodemailer` (SMTP), `resend` (HTTP API), Winston `LoggerService`, `@sentry/nestjs`.

## Global Constraints

- auth-server reads config from `process.env` directly — **no `ConfigService`**.
- Structured logging via injected `LoggerService`, called as `this.logger.getWinstonLogger().warn(msg, { context: 'EmailService', ... })`.
- Errors reported with `Sentry.captureException(err)` (`import * as Sentry from '@sentry/nestjs'`).
- `CommonModule` is `@Global()` and exports `LoggerService`; any module can inject it.
- Default sender: `process.env.EMAIL_FROM ?? 'no-reply@sassy-auth.local'`.
- Test command: `pnpm --filter @sassy-auth/auth-server test`. Type/build gate: `pnpm --filter @sassy-auth/auth-server build`.
- **Console transport is the default** (unset env) so dev & CI send nothing and stay hermetic.

---

## File structure

- `apps/auth-server/src/email/email.types.ts` — `EmailMessage`, `EmailTransport` interfaces + `EMAIL_TRANSPORT` token.
- `apps/auth-server/src/email/transports/console.transport.ts` — logs; sends nothing.
- `apps/auth-server/src/email/transports/smtp.transport.ts` — nodemailer.
- `apps/auth-server/src/email/transports/resend.transport.ts` — Resend SDK.
- `apps/auth-server/src/email/select-transport.ts` — env → transport factory.
- `apps/auth-server/src/email/templates/invitation.template.ts` — `invitationEmail(...)`.
- `apps/auth-server/src/email/templates/password-reset.template.ts` — `passwordResetEmail(...)`.
- `apps/auth-server/src/email/email.service.ts` — `EmailService`.
- `apps/auth-server/src/email/email.module.ts` — module wiring.
- Tests colocated as `*.spec.ts`.
- `.env.example`, `docker-compose.dev.yml`, `README.md` — config + Mailpit.

---

### Task 1: Types, templates, and Console transport

**Files:**
- Create: `apps/auth-server/src/email/email.types.ts`
- Create: `apps/auth-server/src/email/templates/invitation.template.ts`
- Create: `apps/auth-server/src/email/templates/password-reset.template.ts`
- Create: `apps/auth-server/src/email/transports/console.transport.ts`
- Test: `apps/auth-server/src/email/templates/templates.spec.ts`
- Test: `apps/auth-server/src/email/transports/console.transport.spec.ts`

**Interfaces:**
- Produces:
  - `interface EmailMessage { to: string; subject: string; html: string; text: string }`
  - `interface OutgoingEmail extends EmailMessage { from: string }`
  - `interface EmailTransport { readonly name: string; send(msg: OutgoingEmail): Promise<void> }`
  - `const EMAIL_TRANSPORT: unique symbol`
  - `invitationEmail(args: { firstName: string; inviteUrl: string }): EmailMessageParts` where `EmailMessageParts = { subject: string; html: string; text: string }`
  - `passwordResetEmail(args: { firstName: string; resetUrl: string }): EmailMessageParts`
  - `class ConsoleTransport implements EmailTransport` with `name = 'console'`, ctor `(logger?: { info(msg: string): void })`.

- [ ] **Step 1: Write the failing template tests**

Create `apps/auth-server/src/email/templates/templates.spec.ts`:

```typescript
import { invitationEmail } from './invitation.template';
import { passwordResetEmail } from './password-reset.template';

describe('email templates', () => {
  it('invitationEmail embeds the invite URL and name in html + text', () => {
    const out = invitationEmail({ firstName: 'Jane', inviteUrl: 'https://x/accept-invite?token=abc' });
    expect(out.subject).toMatch(/invit/i);
    expect(out.html).toContain('https://x/accept-invite?token=abc');
    expect(out.text).toContain('https://x/accept-invite?token=abc');
    expect(out.text).toContain('Jane');
  });

  it('passwordResetEmail embeds the reset URL and name in html + text', () => {
    const out = passwordResetEmail({ firstName: 'Jane', resetUrl: 'https://x/reset-password?token=abc' });
    expect(out.subject).toMatch(/reset/i);
    expect(out.html).toContain('https://x/reset-password?token=abc');
    expect(out.text).toContain('https://x/reset-password?token=abc');
  });
});
```

- [ ] **Step 2: Run the template tests to verify they fail**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/templates/templates.spec.ts`
Expected: FAIL — cannot find modules `./invitation.template` / `./password-reset.template`.

- [ ] **Step 3: Create the shared types**

Create `apps/auth-server/src/email/email.types.ts`:

```typescript
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface OutgoingEmail extends EmailMessage {
  from: string;
}

export interface EmailTransport {
  readonly name: string;
  send(msg: OutgoingEmail): Promise<void>;
}

export interface EmailMessageParts {
  subject: string;
  html: string;
  text: string;
}

/** DI token for the concrete transport chosen at startup. */
export const EMAIL_TRANSPORT = Symbol('EMAIL_TRANSPORT');
```

- [ ] **Step 4: Implement the templates**

Create `apps/auth-server/src/email/templates/invitation.template.ts`:

```typescript
import type { EmailMessageParts } from '../email.types';

export function invitationEmail(args: { firstName: string; inviteUrl: string }): EmailMessageParts {
  const { firstName, inviteUrl } = args;
  return {
    subject: "You've been invited to Sassy Auth",
    text: `Hi ${firstName},\n\nYou've been invited. Set your password to activate your account:\n${inviteUrl}\n\nThis link expires in 7 days.`,
    html: `<p>Hi ${firstName},</p><p>You've been invited. Set your password to activate your account:</p><p><a href="${inviteUrl}">${inviteUrl}</a></p><p>This link expires in 7 days.</p>`,
  };
}
```

Create `apps/auth-server/src/email/templates/password-reset.template.ts`:

```typescript
import type { EmailMessageParts } from '../email.types';

export function passwordResetEmail(args: { firstName: string; resetUrl: string }): EmailMessageParts {
  const { firstName, resetUrl } = args;
  return {
    subject: 'Reset your Sassy Auth password',
    text: `Hi ${firstName},\n\nA password reset was requested. Choose a new password:\n${resetUrl}\n\nIf you didn't request this, you can ignore this email. This link expires in 1 hour.`,
    html: `<p>Hi ${firstName},</p><p>A password reset was requested. Choose a new password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email. This link expires in 1 hour.</p>`,
  };
}
```

- [ ] **Step 5: Run the template tests to verify they pass**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/templates/templates.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing Console transport test**

Create `apps/auth-server/src/email/transports/console.transport.spec.ts`:

```typescript
import { ConsoleTransport } from './console.transport';

describe('ConsoleTransport', () => {
  it('has name "console" and logs recipient + subject without throwing', async () => {
    const info = jest.fn();
    const t = new ConsoleTransport({ info });
    expect(t.name).toBe('console');
    await t.send({ from: 'no-reply@x', to: 'a@b.co', subject: 'Hi', html: '<p>h</p>', text: 'h' });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('a@b.co'));
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/transports/console.transport.spec.ts`
Expected: FAIL — cannot find module `./console.transport`.

- [ ] **Step 8: Implement the Console transport**

Create `apps/auth-server/src/email/transports/console.transport.ts`:

```typescript
import type { EmailTransport, OutgoingEmail } from '../email.types';

/** Default transport: logs the message; sends nothing. Keeps dev/CI hermetic. */
export class ConsoleTransport implements EmailTransport {
  readonly name = 'console';

  // eslint-disable-next-line no-console
  constructor(private readonly out: { info(msg: string): void } = { info: (m) => console.log(m) }) {}

  async send(msg: OutgoingEmail): Promise<void> {
    this.out.info(`[email:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`);
  }
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/transports/console.transport.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 10: Commit**

```bash
git add apps/auth-server/src/email/
git commit -m "feat(email): message types, templates, and console transport"
```

---

### Task 2: `EmailService` (non-fatal send)

**Files:**
- Create: `apps/auth-server/src/email/email.service.ts`
- Test: `apps/auth-server/src/email/email.service.spec.ts`

**Interfaces:**
- Consumes: `EMAIL_TRANSPORT`, `EmailTransport`, `EmailMessage` (Task 1); `LoggerService` (existing, `src/common/logger/logger.service.ts`).
- Produces: `class EmailService` with `send(msg: EmailMessage): Promise<{ sent: boolean }>`. Reads `process.env.EMAIL_FROM` (default `no-reply@sassy-auth.local`). Never throws.

- [ ] **Step 1: Write the failing service test**

Create `apps/auth-server/src/email/email.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { EmailService } from './email.service';
import { EMAIL_TRANSPORT, type EmailTransport } from './email.types';
import { LoggerService } from '../common/logger/logger.service';

function makeLogger() {
  const warn = jest.fn();
  return {
    provider: { provide: LoggerService, useValue: { getWinstonLogger: () => ({ warn, info: jest.fn() }) } },
    warn,
  };
}

describe('EmailService', () => {
  async function build(transport: EmailTransport) {
    const logger = makeLogger();
    const moduleRef = await Test.createTestingModule({
      providers: [EmailService, logger.provider, { provide: EMAIL_TRANSPORT, useValue: transport }],
    }).compile();
    return { service: moduleRef.get(EmailService), warn: logger.warn };
  }

  it('sends via the transport with the configured from and returns { sent: true }', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    process.env.EMAIL_FROM = 'sender@x.co';
    const { service } = await build({ name: 'fake', send });
    const res = await service.send({ to: 'a@b.co', subject: 'S', html: '<p>h</p>', text: 'h' });
    expect(res).toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: 'sender@x.co', to: 'a@b.co', subject: 'S' }));
  });

  it('never throws when the transport fails — returns { sent: false } and warns', async () => {
    const send = jest.fn().mockRejectedValue(new Error('smtp down'));
    const { service, warn } = await build({ name: 'fake', send });
    const res = await service.send({ to: 'a@b.co', subject: 'S', html: '<p>h</p>', text: 'h' });
    expect(res).toEqual({ sent: false });
    expect(warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/email.service.spec.ts`
Expected: FAIL — cannot find module `./email.service`.

- [ ] **Step 3: Implement `EmailService`**

Create `apps/auth-server/src/email/email.service.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { LoggerService } from '../common/logger/logger.service';
import { EMAIL_TRANSPORT, type EmailMessage, type EmailTransport } from './email.types';

@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
    private readonly logger: LoggerService,
  ) {}

  /** Send an email. Never throws — a transport failure is logged and reported as { sent: false }. */
  async send(msg: EmailMessage): Promise<{ sent: boolean }> {
    const from = process.env.EMAIL_FROM ?? 'no-reply@sassy-auth.local';
    try {
      await this.transport.send({ ...msg, from });
      return { sent: true };
    } catch (err) {
      Sentry.captureException(err);
      this.logger.getWinstonLogger().warn('Email send failed', {
        context: 'EmailService',
        transport: this.transport.name,
        to: msg.to,
        error: err instanceof Error ? err.message : String(err),
      });
      return { sent: false };
    }
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/email.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/auth-server/src/email/email.service.ts apps/auth-server/src/email/email.service.spec.ts
git commit -m "feat(email): EmailService with non-fatal send"
```

---

### Task 3: Transport selection + SMTP + Resend + module wiring

**Files:**
- Install deps (root): `nodemailer`, `@types/nodemailer`, `resend`.
- Create: `apps/auth-server/src/email/transports/smtp.transport.ts`
- Create: `apps/auth-server/src/email/transports/resend.transport.ts`
- Create: `apps/auth-server/src/email/select-transport.ts`
- Create: `apps/auth-server/src/email/email.module.ts`
- Modify: `apps/auth-server/src/app.module.ts` (add `EmailModule` to `imports`)
- Test: `apps/auth-server/src/email/select-transport.spec.ts`

**Interfaces:**
- Consumes: `EmailTransport`, `OutgoingEmail`, `EMAIL_TRANSPORT`, `ConsoleTransport` (Task 1); `EmailService` (Task 2).
- Produces:
  - `class SmtpTransport implements EmailTransport` (`name = 'smtp'`), ctor `(config: { host: string; port: number; user?: string; pass?: string; secure: boolean })`.
  - `class ResendTransport implements EmailTransport` (`name = 'resend'`), ctor `(apiKey: string)`.
  - `selectTransport(env: NodeJS.ProcessEnv): EmailTransport` — Resend > SMTP > Console.
  - `EmailModule` exporting `EmailService`.

- [ ] **Step 1: Install dependencies**

Run:
```bash
pnpm --filter @sassy-auth/auth-server add nodemailer resend
pnpm --filter @sassy-auth/auth-server add -D @types/nodemailer
```
Expected: `package.json` for auth-server lists `nodemailer`, `resend`, and dev `@types/nodemailer`; lockfile updated.

- [ ] **Step 2: Write the failing selection test**

Create `apps/auth-server/src/email/select-transport.spec.ts`:

```typescript
import { selectTransport } from './select-transport';

describe('selectTransport', () => {
  it('chooses resend when RESEND_API_KEY is set', () => {
    expect(selectTransport({ RESEND_API_KEY: 're_x', EMAIL_SMTP_HOST: 'h' } as NodeJS.ProcessEnv).name).toBe('resend');
  });
  it('chooses smtp when only EMAIL_SMTP_HOST is set', () => {
    expect(selectTransport({ EMAIL_SMTP_HOST: 'localhost', EMAIL_SMTP_PORT: '1025' } as NodeJS.ProcessEnv).name).toBe('smtp');
  });
  it('falls back to console when neither is set', () => {
    expect(selectTransport({} as NodeJS.ProcessEnv).name).toBe('console');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/select-transport.spec.ts`
Expected: FAIL — cannot find module `./select-transport`.

- [ ] **Step 4: Implement the SMTP transport**

Create `apps/auth-server/src/email/transports/smtp.transport.ts`:

```typescript
import * as nodemailer from 'nodemailer';
import type { EmailTransport, OutgoingEmail } from '../email.types';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
}

export class SmtpTransport implements EmailTransport {
  readonly name = 'smtp';
  private readonly transporter: nodemailer.Transporter;

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.pass ?? '' } } : {}),
    });
  }

  async send(msg: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  }
}
```

- [ ] **Step 5: Implement the Resend transport**

Create `apps/auth-server/src/email/transports/resend.transport.ts`:

```typescript
import { Resend } from 'resend';
import type { EmailTransport, OutgoingEmail } from '../email.types';

export class ResendTransport implements EmailTransport {
  readonly name = 'resend';
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(msg: OutgoingEmail): Promise<void> {
    const { error } = await this.client.emails.send({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (error) throw new Error(`Resend error: ${error.message}`);
  }
}
```

- [ ] **Step 6: Implement `selectTransport`**

Create `apps/auth-server/src/email/select-transport.ts`:

```typescript
import type { EmailTransport } from './email.types';
import { ConsoleTransport } from './transports/console.transport';
import { SmtpTransport } from './transports/smtp.transport';
import { ResendTransport } from './transports/resend.transport';

/** Choose the transport once, by env priority: Resend > SMTP > Console. */
export function selectTransport(env: NodeJS.ProcessEnv): EmailTransport {
  if (env.RESEND_API_KEY) return new ResendTransport(env.RESEND_API_KEY);
  if (env.EMAIL_SMTP_HOST) {
    return new SmtpTransport({
      host: env.EMAIL_SMTP_HOST,
      port: Number(env.EMAIL_SMTP_PORT ?? '587'),
      secure: env.EMAIL_SMTP_SECURE === 'true',
      user: env.EMAIL_SMTP_USER,
      pass: env.EMAIL_SMTP_PASS,
    });
  }
  return new ConsoleTransport();
}
```

- [ ] **Step 7: Run the selection test to verify it passes**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email/select-transport.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Wire the module**

Create `apps/auth-server/src/email/email.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { EmailService } from './email.service';
import { EMAIL_TRANSPORT } from './email.types';
import { selectTransport } from './select-transport';

@Module({
  imports: [CommonModule],
  providers: [
    EmailService,
    { provide: EMAIL_TRANSPORT, useFactory: () => selectTransport(process.env) },
  ],
  exports: [EmailService],
})
export class EmailModule {}
```

Modify `apps/auth-server/src/app.module.ts` — add the import and register it. The `imports` array currently reads:

```typescript
import { RegistrationModule } from './registration/registration.module';
```

Add below it:

```typescript
import { EmailModule } from './email/email.module';
```

and add `EmailModule` to the `@Module({ imports: [...] })` array (append after `RegistrationModule`).

- [ ] **Step 9: Build to verify wiring + types**

Run: `pnpm --filter @sassy-auth/auth-server build`
Expected: build succeeds (0 errors).

- [ ] **Step 10: Run the full email suite**

Run: `pnpm --filter @sassy-auth/auth-server exec jest src/email`
Expected: PASS (all email specs).

- [ ] **Step 11: Commit**

```bash
git add apps/auth-server/src/email/ apps/auth-server/src/app.module.ts package.json pnpm-lock.yaml apps/auth-server/package.json
git commit -m "feat(email): SMTP + Resend transports, env-based selection, module wiring"
```

---

### Task 4: Config, Mailpit, docs

**Files:**
- Modify: `.env.example`
- Create: `docker-compose.dev.yml`
- Modify: `README.md`

**Interfaces:** none (config/docs only).

- [ ] **Step 1: Add env keys to `.env.example`**

Append to `.env.example`:

```bash
# ── Email ────────────────────────────────────────────────────────────────
# Transport is chosen by priority: RESEND_API_KEY > EMAIL_SMTP_HOST > console.
# Unset = console transport (logs the message, sends nothing) — the dev/CI default.
EMAIL_FROM=no-reply@sassy-auth.local

# Resend (production HTTP API). When set, takes precedence over SMTP.
# RESEND_API_KEY=

# SMTP (local dev via Mailpit, or any SMTP provider). Mailpit defaults:
# EMAIL_SMTP_HOST=localhost
# EMAIL_SMTP_PORT=1025
# EMAIL_SMTP_SECURE=false
# EMAIL_SMTP_USER=
# EMAIL_SMTP_PASS=
```

- [ ] **Step 2: Create the Mailpit dev compose file**

Create `docker-compose.dev.yml`:

```yaml
# Local dev services. Start with: docker compose -f docker-compose.dev.yml up -d
services:
  mailpit:
    image: axllent/mailpit:latest
    container_name: sassy-mailpit
    restart: unless-stopped
    ports:
      - "1025:1025" # SMTP
      - "8025:8025" # Web UI — http://localhost:8025
```

- [ ] **Step 3: Document local email testing in `README.md`**

Add a section to `README.md`:

```markdown
## Local email testing (Mailpit)

By default the auth-server uses a **console** email transport (logs the message, sends nothing) — no setup needed for dev or CI.

To view real emails locally, run [Mailpit](https://mailpit.axllent.org/):

    docker compose -f docker-compose.dev.yml up -d

Then in `.env.local` set:

    EMAIL_SMTP_HOST=localhost
    EMAIL_SMTP_PORT=1025

Sent emails appear at http://localhost:8025. For production, set `RESEND_API_KEY` instead (takes precedence over SMTP).
```

- [ ] **Step 4: Commit**

```bash
git add .env.example docker-compose.dev.yml README.md
git commit -m "docs(email): env keys, Mailpit dev compose, README"
```

---

## Self-review notes

- **Spec coverage:** Section 1 (transports, env priority, non-fatal failure, boundary) and Section 5 (env, Mailpit, deps) of the design are covered by Tasks 1–4. Password-reset/invitation *templates* live here (Tasks 1) because they belong to the email module; their *callers* are in Plans 2 & 3.
- **No placeholders:** every step has runnable code/commands.
- **Type consistency:** `EmailMessage`/`OutgoingEmail`/`EmailTransport`/`EMAIL_TRANSPORT` are defined in Task 1 and consumed unchanged in Tasks 2–3. `selectTransport(env)` and `EmailService.send(): Promise<{ sent: boolean }>` signatures are stable across the later plans.
