<!--
If this fixes a security vulnerability, please stop and read SECURITY.md —
report it privately first so a fix and an advisory can go out together.
-->

## What this changes

<!-- One or two sentences. Link the issue if there is one: Fixes #123 -->

## Why

<!-- The problem being solved. If it is a documented gap, link the Known
     Limitations entry or the bug number. -->

## How it was verified

<!-- Say what you actually ran, not what should pass. -->

- [ ] `pnpm test`
- [ ] `pnpm --filter @sassy-auth/auth-server build` (typecheck gate)
- [ ] `pnpm --filter @sassy-auth/admin-e2e test:e2e`
- [ ] Manually exercised in the admin console

## Tests

- [ ] Added a test covering the new behaviour
- [ ] For a bug fix: the test fails without the fix and passes with it
- [ ] No new test — explain why below

## Security surface

- [ ] Touches authentication, sessions, tokens, or permission checks
- [ ] Changes the data model, a token's contents, or an existing HTTP contract
- [ ] Neither

<!-- If either box is ticked, describe what an attacker gains or loses. -->
