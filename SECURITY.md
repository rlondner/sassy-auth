# Security Policy

## Project status

**SassyAuth is experimental software. It has not been security-audited, and it is
not recommended for production use without your own review.**

SassyAuth handles authentication, session management, and token issuance — the
parts of a system where defects have the highest blast radius. It is published
in the hope that it is useful and instructive, not as a hardened, battle-tested
product. There is no 1.0 release, no stability guarantee, and no deployment in
the wild that the maintainers are aware of.

If you are evaluating it for something that matters, read
[Known Limitations](README.md#known-limitations) first. That section is kept
deliberately current and lists the gaps we already know about.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through either channel:

1. **GitHub Security Advisories** — [open a private advisory](https://github.com/rlondner/sassy-auth/security/advisories/new).
   This is preferred: it keeps the report, the discussion, and the eventual fix
   in one place.
2. **Email** — `contact@milissai.com`.

Please include, as far as you can:

- What the issue is and which component is affected (`auth-server`, `admin`,
  `packages/db`, the FastAPI sample resource server)
- Steps to reproduce, or a proof-of-concept
- The commit SHA you tested against
- What an attacker gains — the impact matters more than the mechanism

## What to expect

This is a personal project maintained in spare time, so please calibrate
accordingly:

| Stage | Target |
| --- | --- |
| Acknowledgement of your report | 5 business days |
| Initial assessment | 10 business days |
| Fix or documented mitigation | Depends on severity and scope |

If you have not heard back within the acknowledgement window, feel free to nudge
by email — it means the notification was missed, not ignored.

We will credit you in the advisory and release notes unless you would rather
stay anonymous. There is no bug bounty.

## Scope

**In scope** — anything in this repository that undermines the guarantees the
project claims to make:

- Authentication bypass, privilege escalation, or cross-tenant data access
- Token forgery, or flaws in RS256 signing and JWKS verification
- OAuth2 / PKCE flow defects (code interception, redirect handling, replay)
- Session fixation or hijacking
- Injection reachable through the admin console or management API
- Secrets exposure in logs, error responses, or telemetry

**Out of scope:**

- Issues already listed under [Known Limitations](README.md#known-limitations).
  These are disclosed, tracked, and not news — though a report showing that one
  is materially worse than documented is very much in scope.
- The default seed credentials. The seed exists to make local development
  frictionless and uses a well-known password by design; it refuses to run with
  that default unless `NODE_ENV` is `development` or `test`. Set
  `SEED_ADMIN_PASSWORD` for any other environment.
- Findings from automated scanners submitted without a working reproduction.
- Vulnerabilities in upstream dependencies with no SassyAuth-specific exploit
  path. Report those upstream; tell us if we should pin or patch.
- Missing hardening in the sample FastAPI resource server
  (`apps/resource-server-fastapi`). It is illustrative example code, not a
  component we suggest deploying.

## Disclosure

We ask for coordinated disclosure: give us a chance to ship a fix before going
public. Given the project's experimental status and small user base, we are not
going to argue about timelines — if you have waited a reasonable period and want
to publish, that is your call.
