# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-08-17

**Daily review: two new PRs in the window (#328, #329), both Jules "Palette" PRs that again ride an
`apps/auth-server` change under a cosmetic title; 3 new bugs (0256 Medium, 0257 Medium, 0258 Low),
all pre-merge hygiene / scope-creep / test-quality.** `git fetch origin` and `gh` both work (keyring
credential). `master` is still frozen at `a78d4a7` (2026-07-15, the 2FA merge) — **33 days** with no
merge.

- **New activity: [PR #328](https://github.com/rlondner/sassy-auth/pull/328)** (Jules, "🎨 Palette:
  Add localized ARIA labels and tooltips to row action triggers") and
  **[PR #329](https://github.com/rlondner/sassy-auth/pull/329)** (Jules, "🎨 Palette: Standardize
  ShareLinkDialog copy feedback hook"). No new commits on `master` (`git log --since` in-window = empty).
- **PR #329 is mostly good:** it moves `ShareLinkDialog` off inline `useState`+`setTimeout` onto the
  existing `useCopyFeedback` hook (`apps/admin/lib/use-copy-feedback.ts`, present on `master` —
  verified), removing the unmount `setTimeout` leak; adds a real `share-link-dialog.test.tsx`; and
  fixes the `app-create-drawer.test.tsx` payload assertion (**bug-0243** fix in the PR head). Its one
  problem is an unrelated `autoSignIn: false` rider.
- **PR #328 is a duplicate + heavily over-scoped:** it re-does the same
  `aria-label={t('common.moreActions')}` + `en/fr.json` localization already in the open PRs #316
  and #324, and additionally rewrites `apps/admin/app/login/actions.ts` (untested), adds
  `autoSignIn: false`, edits `apps/admin-e2e/auth-state.setup.ts`, and globally stubs the UI Tooltip
  in `jest.setup.ts` — all under a "row action tooltips" title.
- **3 new bugs** (each filed as its own PR) — see [BUGS_2026-08-17.md](./bugs/BUGS_2026-08-17.md).
  Highest real bug number is now **0258**.
  - 🟠 **[bug-0256](./bugs/bug-0256.md)** (Medium) — `autoSignIn: false` is added to
    `auth.config.ts` by **three** open PRs (#316, #328, #329): an unstated, untested auth-server
    behavior change (disables auto-session on sign-up) smuggled under cosmetic titles → guaranteed
    3-way merge conflict on one line. Continuation of the auth-server-smuggling lineage
    (bug-0246/0247/0251). Fix: extract it to one purpose-named auth PR with a test; strip from all three.
  - 🟠 **[bug-0257](./bugs/bug-0257.md)** (Medium) — PR #328 is the **third** overlapping
    row-action-tooltip/`common.moreActions` localization PR (dup of #316 and #324; extends bug-0254
    to three-way) and re-bundles an untested `login/actions.ts` rewrite + `auth.config.ts` +
    e2e-setup edits under a UI title. Fix: pick one carrier (prefer #324), split #328's real non-UI
    improvements into their own tested PRs.
  - 🟢 **[bug-0258](./bugs/bug-0258.md)** (Low) — PR #328 globally stubs the `@sassy-auth/ui` Tooltip
    primitives in `jest.setup.ts`, blinding the whole admin Jest suite to real tooltip behavior
    (provider requirement, `asChild` composition) — escalates bug-0251, masks bug-0252.
- **Not filed (verified):** #329's `useCopyFeedback` refactor (hook exists on `master`, correct);
  and #328's `login/actions.ts` cookie rewrite is a refactor, **not** a `master` defect — on
  `master`, `cookies().toString()` reflects the just-set session token within the same request
  (same false-positive discipline that retracted bug-0249).
- **Unchanged prior findings** (all in unmerged PRs; `master` unaffected): 🔴 bug-0250 (seed 2FA
  suppression, #316/#315), 🟡 bug-0251 (#316 scope creep), 🟡 bug-0253 (native-`title` copy
  confirmation in #316), 🟠 bug-0254 / 🟢 bug-0255 (#324↔#316 duplication + coverage), 🔴 bug-0243
  (`apps/admin` Jest red on `master`, fix #287 unmerged).
- **Net:** the row-action-tooltip concern is now spread across **three** open PRs (#316/#324/#328)
  and `autoSignIn:false` across three (#316/#328/#329). The systemic blocker remains the **33-day
  merge freeze**, which keeps regenerating overlapping PRs. #329's copy-feedback refactor is the one
  piece worth landing (minus its auth rider).

## [Unreleased] — 2026-08-15

**Daily review: one new PR in the window (#324), functionally correct and — for the first time in
this lineage — cleanly scoped; 2 new hygiene bugs (0254 Medium, 0255 Low).** `git fetch origin` and
`gh` both work (keyring credential). `master` is still frozen at `a78d4a7` (2026-07-15, the 2FA
merge) — **31 days** with no merge.

- **New activity: [PR #324](https://github.com/rlondner/sassy-auth/pull/324)** (Jules, "🎨 Palette:
  Add localized ARIA labels to table row action buttons"). Admin-only (8 files, 5 tables + 1 test +
  `en.json`/`fr.json`) — **no `apps/auth-server`/seed edits**, unlike #303/#306/#316. It swaps the
  hardcoded `aria-label="more actions"` on each table's `more_vert` button for
  `aria-label={t('common.moreActions')}`, adds that key to both message files, and translates the
  top-level `common` block in `fr.json` (save/edit/delete/confirm → French).
  - ✅ **Correct** — all 5 tables use root-scope `useTranslations()`, so the key resolves; verified.
  - ✅ **Fixes [bug-0244](./bugs/bug-0244.md)** (fr.json `common` labels were English placeholders) —
    in the PR head, not on `master`.
- **2 new bugs** (each filed as its own PR) — see [BUGS_2026-08-15.md](./bugs/BUGS_2026-08-15.md).
  Highest real bug number is now **0255**.
  - 🟠 **[bug-0254](./bugs/bug-0254.md)** (Medium) — #324 **duplicates the still-open PR #316**: the
    identical 5 `aria-label` hunks, the same `common.moreActions` keys, and the same `fr.json`
    `common` fix all already live in #316. Both open → guaranteed merge conflict. #324 is the *clean
    subset* (no bug-0250/0251 auth/seed payload); #316 does more (copy-button localization) but is
    blocked. Recurring Jules duplicate-generation pattern (cf. bug-0245, bug-0248). Recommended
    resolution: land the a11y/i18n slice via #324, reduce #316 to only its unique safe delta.
  - 🟢 **[bug-0255](./bugs/bug-0255.md)** (Low) — the label change lands in 5 tables but only
    `apps-table.test.tsx` gets an assertion; the 4 sibling table suites are left unverified.
- **Unchanged prior findings** (all in unmerged PRs; `master` unaffected): 🔴 bug-0250 (seed 2FA
  suppression, still in #316/#315), 🟡 bug-0251 (#316 scope creep), 🟡 bug-0253 (native-`title` copy
  confirmation in #316), 🔴 bug-0243 (`apps/admin` Jest red on `master`, fix #287 unmerged).
- **Net:** the first Jules PR here that doesn't smuggle an auth-server change; correct and low-risk.
  Its only issues are pre-merge hygiene (duplicates the blocked #316, under-tests itself). The
  systemic blocker remains the **31-day merge freeze**, which keeps producing overlapping PRs.

## [Unreleased] — 2026-08-14

**Daily review: strict 24h window empty; reviewed the one revision the prior run missed (PR #316
`b3acc18`), 1 new Minor bug (0253).** `git fetch origin` **worked** this run (keyring credential)
and refreshed the PR refs; `gh` also works. `master` is still frozen at `a78d4a7` (2026-07-15, the
2FA merge) — **30 days** with no merge. No new commits or PR updates landed in the strict last-24h
window. The only unreviewed change was **PR #316**'s force-push to head **`b3acc18`** (2026-08-13
10:14 UTC — 9 minutes *after* the 2026-08-13 review pulled its data at head `42a518d`), reviewed
here in full.

- **What `b3acc18` changed:** it **replaces the Radix `<Tooltip>` with a native `title=`**
  attribute on the copy button and the `more_vert` row-action button across all 5 admin tables,
  and removes the now-unused `Tooltip*` imports and their passthrough test mocks (10 files,
  `+98 / −142`). **The seed / `auth.config.ts` edits were not touched.**
- **Status changes to prior findings:**
  - ✅ **[bug-0252](./bugs/bug-0252.md)** (nested double-`asChild`) — **resolved by this revision**
    (no Radix Slot stack remains). Fix is in the PR head, not on `master`, so `bug-0252.md` keeps
    `Fixed: false`.
  - ✅ **[bug-0249](./bugs/bug-0249.md)** (retracted "missing `TooltipProvider`") — **permanently
    moot**; no Radix Tooltip remains.
  - 🟡 **[bug-0251](./bugs/bug-0251.md)** (scope creep + mocks-away-its-primitive) — the test-mock
    half is **mooted** (primitive + mocks removed); the **scope-creep half stands** (the PR still
    silently bundles `auth.config.ts` + 3 seed edits under a cosmetic title).
  - 🔴 **[bug-0250](./bugs/bug-0250.md)** (Critical — seed `twoFactorPromptedAt: new Date()`
    suppresses the 2FA enrollment prompt) — **persists unchanged** in `b3acc18`
    (`seed.ts:120`, `demo-multitenant.ts:103`, `demo-resource-server.ts:163`; `autoSignIn:false`
    at `auth.config.ts:146`). Still the merge blocker on #316 (and #315).
- **1 new bug** (filed as its own PR — bug-0253 → **#322**) — see
  [BUGS_2026-08-14.md](./bugs/BUGS_2026-08-14.md). Highest real bug number is now **0253**.
  - **[bug-0253](./bugs/bug-0253.md)** (🟡 Minor / a11y-UX) — the native-`title` rewrite binds the
    copy button's `title`/`aria-label` to the transient `copied` state, but a native `title`
    doesn't update while the pointer stays on the button (browsers sample it at hover-start) and an
    `aria-label` mutation doesn't re-announce — so PR #316's own advertised "dynamic copied
    announcement" no longer works in the normal hover→click path; only the `content_copy → check`
    icon swap survives. Restore a reactive tooltip or add an `aria-live` announcement.
- **Net:** `b3acc18` is a reasonable cleanup of the tooltip layer (kills the retracted-crash
  concern and the nested-`asChild` fragility) but leaves the Critical seed 2FA-suppression
  (bug-0250) intact under a still-cosmetic title (bug-0251) and quietly regresses the copy
  confirmation (bug-0253). `master` itself is unchanged and safe — none of this is merged.
- **Docs:** `README.md` reviewed and confirmed current (it already documents `PLATFORM_REQUIRE_2FA`
  / `TWO_FACTOR_TRUST_DAYS` and carries a warning box against pre-setting `twoFactorPromptedAt` in
  seeds); the bug-0250 note was refreshed to record that the regression persists in #316's latest
  head despite the tooltip rewrite.

## [Unreleased] — 2026-08-13

**Daily review: one new PR (#316) reviewed via `gh`, 3 new bugs (1 Critical) + 1 retracted.**
GitHub access worked this run through the authenticated **`gh` CLI** (keyring token) —
`curl api.github.com` is still proxy-blocked and a raw `git fetch` still fails on the rejected
`.env.local` PAT. `master` is still frozen at `a78d4a7` (2026-07-15, the 2FA merge) — **29 days**
with no merge. The only new activity in the window is **Jules PR #316** ("🎨 Palette:
Standardized Table Copy and Row Action Accessible Tooltips", opened 2026-08-13), reviewed in full.

- **3 confirmed new bugs** (each filed as its own PR — bug-0250 → #318, bug-0251 → #319,
  bug-0252 → #320) — see [BUGS_2026-08-13.md](./bugs/BUGS_2026-08-13.md). Highest real bug number
  is now **0252**.
  - **[bug-0249](./bugs/bug-0249.md)** — ⚪ **RETRACTED same day (false positive).** A "Tooltip
    has no `TooltipProvider` → tables crash" claim was **wrong**: `SidebarProvider` (packages/ui)
    renders `<TooltipProvider>` around the whole admin shell, so the tables render fine. PR #317
    (the report) was closed and its branch deleted. This is the *same* false positive the
    2026-08-04 review already recorded; kept as `bug-0249.md` to prevent a third re-file.
  - **[bug-0250](./bugs/bug-0250.md)** (🔴 Critical / security posture) — seed scripts
    (`seed.ts`, `demo-multitenant.ts`, `demo-resource-server.ts`) set
    `twoFactorPromptedAt: new Date()`, so `shouldPromptTwoFactor` returns `false` and the 2FA
    enrollment prompt is **suppressed for every seeded user** (platform admins + demo) for
    `TWO_FACTOR_TRUST_DAYS` (14 default). Not cleared by re-seed. Present in **#316 and #315**;
    absent on `master`.
  - **[bug-0251](./bugs/bug-0251.md)** (🟡 Warning / process) — scope creep: the cosmetically
    titled "table tooltips" PR silently bundles `auth.config.ts` (`autoSignIn: false`) + three
    seed-file edits (bug-0250), and mocks the `@sassy-auth/ui` Tooltip primitive to passthroughs
    in the table tests (coverage-of-a-stub). Recurrence of bug-0247/0248 + bug-0093. Conflicts
    with open PRs #315/#314.
  - **[bug-0252](./bugs/bug-0252.md)** (🟡 Minor / a11y) — nested double-`asChild`
    (`TooltipTrigger asChild` → `DropdownMenuTrigger asChild` → one `<button>`) on the row-action
    trigger across all 5 tables; plausible Radix Slot fragility (tooltip may not dismiss when the
    menu opens). Low-confidence, flagged for a runtime check.
- **The a11y intent is sound** — localized `aria-label`s (the previously **hardcoded**
  `"more actions"` is now `t('common.moreActions')`) and a dynamic "copied" announcement are
  genuine improvements. The substantive finding is the bundled seed regression under a cosmetic
  title — not the tooltip idea, which renders correctly.
- **`master` is still red** (bug-0243 admin Jest suite) and **frozen for 29 days**; three open
  Jules PRs (#314/#315/#316) collide on `auth.config.ts` + seeds.
- **Follow-ups** (blockers on #316 + the merge backlog + infra) →
  [TODO_2026-08-13.md](./todo/TODO_2026-08-13.md). Full review detail →
  [CR_2026-08-13.md](./code_reviews/CR_2026-08-13.md).

> Note: this entry, like every daily-review entry since 2026-07-21, stacks above unmerged work.
> `master`'s CHANGELOG still tops out earlier; these entries live on the review branches / PRs.

## [Unreleased] — 2026-08-05

**Daily review: GitHub access restored, one new PR reviewed, 2 new bugs.** The `github` MCP
connector was available this run (prior runs 2026-07-27 → 2026-08-04 were blocked by the proxy /
rejected PAT and produced only blocker reports). `master` is still frozen at `a78d4a7`
(2026-07-15); the only new source activity in the window was **Jules PR #306** ("🎨 Palette:
Interactive Show/Hide Password Toggle for LoginForm", opened 2026-08-05), reviewed in full.

- **2 new bugs** — see [BUGS_2026-08-05.md](./bugs/BUGS_2026-08-05.md). Highest bug number is now
  **0248**.
  - **[bug-0247](./bugs/bug-0247.md)** (Warning / security) — PR #306 bundles a **second,
    divergent unfenced session-gate bypass** (`process.env.SEEDING === '1'`) into
    `apps/auth-server/src/auth/auth.config.ts`. It reintroduces the bug-0246 defect under a
    renamed variable, with no `NODE_ENV` fence, no regression test, and no docs. Two open PRs
    (#303 `SEED_RUNNING`, #306 `SEEDING`) now patch the same `create.before` hook incompatibly —
    a regression risk for the bug-0074 account-status enforcement if either merges as-is.
    Confirmed absent on `master`.
  - **[bug-0248](./bugs/bug-0248.md)** (Minor / process) — three open PRs (#294, #296, #306)
    implement the **same** login password toggle (guaranteed conflicts + wasted review), and
    #306 exhibits **scope creep**: it silently bundles the bug-0243 test fix and an unrelated
    `fr.json` reformat under a cosmetic UI title, hiding the security-relevant `auth.config.ts`
    edit.
- **The password-toggle feature itself is sound** — correct `type="button"`, aria-labels,
  `pr-10` padding, and it ships a unit test. The findings are about what PR #306 bundles around
  it, not the toggle.
- **`master` is still red.** The `apps/admin` Jest suite has failed since `a78d4a7` (bug-0243)
  and has now been independently patched by three Jules PRs because the standalone fix (PR #287)
  never merged. CI is not gating on this suite.
- **Follow-ups** (mostly merge-hygiene, plus the in-flight bug-0247 security item) →
  [TODO_2026-08-05.md](./todo/TODO_2026-08-05.md). Full review detail →
  [CR_2026-08-05.md](./code_reviews/CR_2026-08-05.md).

> Note: this entry, like every daily-review entry since 2026-07-21, stacks above unmerged work.
> `master`'s CHANGELOG still tops out earlier; these entries live on the review branches / PRs
> until the backlog (#287–#290, #304, #305, and today's) is merged.

## [Unreleased] — 2026-07-22

**Daily review: no new source activity.** `master` has not advanced since `a78d4a7`
(2026-07-15). The last-24h window contained only (a) the 2026-07-21 review's own output
(bugs 0243–0245 + docs, still unmerged in PRs #287–#290) and (b) two Jules-bot "Palette"
commits (`7c4e605`, `09391e7`) that the 2026-07-21 review already covered under bug-0245.

- **0 new bugs** — see [BUGS_2026-07-22.md](./bugs/BUGS_2026-07-22.md). Highest bug number
  remains **0245**.
- **Verified bug-0243 is still red on `master`**: the `apps/admin` Jest suite fails because
  `app-create-drawer.test.tsx` asserts a 3-field create payload while the component now sends
  5 (`twoFactorTrustDays`, `requireTwoFactor`). Fix exists only in unmerged PRs.
- **Follow-ups are merge-hygiene, not code** — the daily review keeps re-reviewing a frozen
  tree because its output PRs never merge. See [TODO_2026-07-22.md](./todo/TODO_2026-07-22.md).

> Note: the 2026-07-21 CHANGELOG entry (Jules palette PRs + bugs 0243–0245) is not yet on
> `master`; it is pending in PR #290. This entry stacks above it once #290 lands.

## [Unreleased] — 2026-07-08

61 commits in the last 24 hours — the most productive day in the project's history. An overnight autonomous session closed ~76 bugs including **all 9 Critical-severity issues**. Today's post-fix regression scan found 15 new bugs (2 critical, 6 warning, 7 minor).

### Fixed (~76 bugs)

#### All 9 Critical bugs — CLOSED

- **bug-0001** — Cross-tenant org access via `checkPermission` (b62d543)
- **bug-0038** — JWT `permissions`→`scope` migration (8740829)
- **bug-0039** — In-memory OAuth code store → `SaOauthCode` DB table (296df3e)
- **bug-0054** — `redirect_uri` not bound to authorization code (70c9589)
- **bug-0074** — Inactive/pending users could authenticate (04ad774)
- **bug-0094** — `checkPermissionForApp` silent grant on undefined `targetAppId` (cbfe798)
- **bug-0147** — Username/phoneNumber non-unique login collision (98c0111)
- **bug-0148** — PublicId 'placeholder' race on concurrent creates (6db55b7)
- **bug-0183** — `createPermission` allows `platform.*` names (bbd4e4e)

#### Auth-server hardening (33 bugs)

bug-0034, 0080, 0092, 0097, 0115, 0138, 0139, 0140, 0144, 0149, 0152, 0153, 0154, 0158, 0163, 0164, 0166, 0167, 0168, 0169, 0175, 0179, 0184, 0185, 0186, 0187, 0192, 0193, 0194, 0197, 0198, 0209, 0210

#### Admin UX + security (27 bugs)

bug-0050, 0136, 0137, 0141, 0142, 0145, 0146, 0155, 0159, 0160, 0165, 0170, 0171, 0189, 0190, 0191, 0195, 0196, 0199, 0200, 0201, 0202, 0203, 0204, 0205, 0206, 0207

#### Test infrastructure (7 bugs)

bug-0173, 0178, 0181, 0208, 0211, 0212, 0213

### New bugs found (15)

See [BUGS_2026-07-08.md](./bugs/BUGS_2026-07-08.md) and [TODO_2026-07-08.md](./todo/TODO_2026-07-08.md).

#### Critical (2) — timing side-channels undermining the bug-0209 fix

- **bug-0214** — `directLogin` org/app mismatch check returns 403 before scrypt — defeats timing guard, enables user enumeration + tenant-membership oracle.
- **bug-0215** — Social-only users (no credential row) skip scrypt in `directLogin` — leaks authentication method via timing.

#### Warning (6)

- **bug-0216** — Post-login OAuth redirect path missing `/api/token` prefix — always rejected by admin's `validateNextUrl`.
- **bug-0217** — Helmet CSP blocks Swagger UI in development (comment incorrectly claims CSP is prod-only).
- **bug-0218** — `updateUser` status guard bypass: `pending→inactive→active` circumvents invitation acceptance.
- **bug-0219** — `updateUser` missing self-modification guard (unlike `deleteUser`, `setUserRoles`, `setUserDirectPermissions`).
- **bug-0220** — Expired `SaOauthCode` rows accumulate unboundedly (no cleanup job).
- **bug-0221** — `updateUserAction` lacks try/catch; swallows NEXT_REDIRECT sentinel on 401.

#### Minor (7)

- **bug-0222** — `user-view-drawer` initial-load effect lacks cancellation flag — stale data on rapid open/close.
- **bug-0230** — Admin `next.config.ts` security headers missing HSTS.
- **bug-0231** — `accept-invite-form` error message lacks `role="alert"`.
- **bug-0232** — Five search inputs across table components lack accessible labels.
- **bug-0233** — Pagination page-size selects lack accessible labels.
- **bug-0234** — `use-copy-feedback` hardcoded English toast bypasses i18n.
- **bug-0235** — E2E `afterAll` cleanup omits `SaOauthCode` table.

### Added

- `helmet` middleware on auth-server (bug-0154)
- `@nestjs/throttler` rate limiting: 120 req/min default, 10 req/min on auth endpoints (bug-0080)
- `resolveListScope` helper for list endpoints (bug-0001)
- `generatePendingPublicId()` replaces 'placeholder' literal (bug-0148)
- `useCopyFeedback` hook consolidates 13 clipboard copy sites (bug-0155)
- `GET /api/apps/:id` endpoint (bug-0164)
- Admin security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Cache-Control (bug-0191)
- Admin `loading.tsx` for loading indicators during navigation (bug-0207)
- `AccessDeniedPanel` component for 403 states (bug-0196)
- `SaUser.createdAt` and `lastLoginAt` fields (bug-0186)
- 5 new Prisma migrations (see OVERNIGHT_REPORT_2026-07-08.md §4)

### Changed

- `ValidationPipe` now has `forbidNonWhitelisted: true` (bug-0194)
- Auth-server `tsconfig.json` upgraded to `strict: true` (bug-0197)
- Swagger UI gated behind `NODE_ENV !== 'production'` (bug-0153)
- BetterAuth session config now explicit (`expiresIn`, `updateAge`) (bug-0158)
- 401 responses in admin redirect to `/login` via `apiFetch` (bug-0136)

### Project health

Estimated open bugs: **~153** (192 prior − 54 newly fixed + 15 new). All Critical-severity bugs resolved. The 2 new Critical bugs (bug-0214, 0215) are regressions in the timing guard — they need priority attention before the directLogin fix can be considered complete.

## [Unreleased] — 2026-07-09

Reviewing the 15 commits that landed on 2026-07-08 — a massive overnight bug-fixing sprint that closed **~55 bugs** including **all 9 Criticals**. 16 new bugs found in the post-fix review. A concurrent session (PRs #238–#252) fixed 9 of the 16 and filed+fixed 6 more (using overlapping numbers 0223–0228 for different issues). Colliding entries renumbered to 0230–0235.

### Bugs found (16) — 9 fixed same-day, 7 open

See [BUGS_2026-07-09.md](./bugs/BUGS_2026-07-09.md) and [TODO_2026-07-09.md](./todo/TODO_2026-07-09.md).

#### Fixed same-day (9) — PRs #238–#246

- **bug-0214** — `directLogin` org/app mismatch timing oracle (PR #238)
- **bug-0215** — `directLogin` OAuth-only account timing gap (PR #239)
- **bug-0216** — Post-login OAuth `next` path broken (PR #240)
- **bug-0217** — Helmet CSP breaks Swagger UI in dev (PR #241)
- **bug-0218** — `updateUser` status guard one-hop bypass (PR #242)
- **bug-0219** — `updateUser` missing self-modification guard (PR #243)
- **bug-0220** — `SaOauthCode` no cleanup job (PR #244)
- **bug-0221** — `updateUserAction` swallows NEXT_REDIRECT (PR #245)
- **bug-0222** — `user-view-drawer` lacks cancellation (PR #246)

#### Still open — Warning (3)

- **bug-0232** — BetterAuth sign-in/sign-up routes bypass NestJS ThrottlerGuard entirely (mounted as raw Express middleware).
- **bug-0233** — Bug-0206 `selected` rebase fix not applied to UsersTable — stale data in user drawer after refresh.
- **bug-0234** — `createUserAction` and `updateUserAction` leak raw server error messages to UI after bug-0050 made `apiFetch` richer.

#### Still open — Minor (4)

- **bug-0229** — App edit drawer shows "name required" error when URL is empty.
- **bug-0230** — Session validation cache negative-caches 5xx responses — 10s false lockout on transient errors.
- **bug-0231** — Throttler `@Throttle` decorator values duplicate module config — silently masks central changes.
- **bug-0235** — `listUsers` silently truncates at 500 with no pagination metadata or indicator.

### Summary of 2026-07-08 changes (15 commits)

#### Security (4 commits)

- **`880b5e6`** sec+ux(oauth): Timing-guard on `directLogin` to prevent user enumeration (bug-0209). Browser-friendly authorize 401 now redirects to `/login?next=` instead of returning JSON (bug-0149).
- **`51769a8`** sec+fix: 6 hygiene items — social provider env validation (bug-0175), `AcceptInvitationDto` `@MaxLength` (bug-0184), invitation URL env warning (bug-0185), and three minor fixes (bug-0166, 0168, 0169).
- **`6a39e9d`** sec(auth): `removeRole` escalation guard (bug-0097), startup env validation (bug-0115), set-replace `@ArrayMaxSize` caps (bug-0034).
- **`0b6ef0d`** sec(auth): Rate limiting via `@nestjs/throttler` — 120 req/min global, 10 req/min on auth endpoints (bug-0080). Explicit BetterAuth session config (bug-0158).

#### Bug fixes (7 commits)

- **`2e0190b`** fix(admin): Rebase table `selected` state on refresh — drawers now show current server data, not stale snapshots (bug-0206).
- **`4a193dc`** fix(admin): `apiFetch` now includes response body in errors (bug-0050), `RoleViewDrawer` respects `canWrite` (bug-0205), added `loading.tsx` for admin routes (bug-0207), and 3 related dead-code fixes (bug-0199, 0200, 0201).
- **`f9403a2`** fix: Async cancellation flags + `updateUser` status transition guard — prevents pending→active without invitation (bug-0137, 0142, 0145, 0152).
- **`1039b69`** fix: `listUsers` hard cap at 200 (bug-0140), accept-invite timer cleanup on unmount (bug-0160), resource-server docs comment (bug-0167), clipboard toast (bug-0171).
- **`23e9fe4`** fix(admin+ui): Middleware 401 redirect (bug-0136), PII scrubbing (bug-0146), React `useId` for SSR-safe IDs (bug-0170), `FormField` `aria-describedby` (bug-0203), whitespace input guards (bug-0141).
- **`7f869b3`** fix(users): `removeRole` P2025 handling (bug-0138), `resendInvitation` transaction (bug-0139), `SaInvitation.expiresAt` index (bug-0144).
- **`51769a8`** (also in Security above) — fixes bug-0166, 0168, 0169.

#### Performance (1 commit)

- **`e1c06d0`** perf(admin): Session validation cache with 10s TTL — reduces auth-server round-trips on admin page navigation (bug-0165). 500-entry cap with two-phase eviction prevents memory leaks.

#### Refactor (1 commit)

- **`fd45111`** refactor(admin): `useCopyFeedback` hook — replaces 13 unmount-leaking `setTimeout` instances across table components (bug-0155).

#### Features (1 commit)

- **`00927c3`** feat(users): Expose `createdAt` and `lastLoginAt` on User API — includes DB migration to add `SaUser.createdAt` and `SaUser.lastLoginAt` columns (bug-0186).

#### Tests (1 commit)

- **`6b534d1`** test(e2e): Reinstate `afterAll` cleanup + absolute Prisma path (bug-0173, 0178, 0181). E2E tests now properly clean up non-platform data after runs.

#### Docs (1 commit)

- **`cf42543`** docs: Overnight autonomous bug-triage report documenting session outcomes, decisions needed, and attention items.

### New dependencies

- `helmet` — HTTP security headers on auth-server (bug-0154)
- `@nestjs/throttler` — rate limiting on auth-server (bug-0080)

### New database migrations

```
20260707180000_bug_0147_unique_username_phone
20260707180500_bug_0039_saoauthcode_table
20260707190000_bug_0179_betterauth_indexes
20260708100000_bug_0186_saUser_created_last_login
20260708120000_bug_0144_invitation_expires_at_index
```

### New helpers

- `apps/auth-server/src/common/permissions/resolve-list-scope.ts` — org-scoping for list endpoints (bug-0001)
- `apps/auth-server/src/common/pending-public-id.ts` — per-request UUID for placeholder publicIds (bug-0148)
- `apps/admin/lib/use-copy-feedback.ts` — canonical clipboard hook (bug-0155)

### Known open bugs

Net open bugs: **~20** (13 from backlog + 7 still-open from today). Down from ~210 at the start of 2026-07-08. All 9 Criticals closed. A concurrent session also fixed 6 additional bugs (0223–0228, different issues from this catalog). The legacy backlog (bug-0002–0135) has ambiguous status and needs reconciliation.

### Project health note

This is a landmark day for the project. The overnight session on 2026-07-08 cleared the entire Critical backlog and the vast majority of Warning/Minor bugs. The three new bugs found today are all Minor — two are narrow timing/caching edge cases and one is a maintenance hygiene issue. The README Known Limitations section has been updated to reflect the current state. The remaining open bugs are either test-coverage gaps, UX polish, or items waiting on design decisions. The project is in a materially better state than at any prior daily review.
---

## [Unreleased] — 2026-07-07

No new commits in the last 24 hours. The last commit is `37f738a` (2026-07-01), reviewed across five prior daily reviews (2026-07-02 through 2026-07-06). Today's review is a **multi-agent deep sweep** covering: server action error handling, admin security headers/caching, auth-server bootstrap/startup, i18n completeness, shared UI accessibility, admin page authorization, seed script correctness, and TypeScript configuration. 22 new bugs found (0 critical, 10 warning, 12 minor). No bugs fixed.

### Bugs found (22 new)

See [BUGS_2026-07-07.md](./bugs/BUGS_2026-07-07.md) and [TODO_2026-07-07.md](./todo/TODO_2026-07-07.md).

#### Warning (10)

- **bug-0189** — `signOutAction` crashes on auth-server outage — session cookie not cleared, user stuck.
- **bug-0190** — Five users server actions (`getUserRolesAction`, `getEffectivePermissionsAction`, `getUserDirectPermissionsAction`, `getRolesAction`, `getAppPermissionsAction`) propagate unhandled exceptions — drawer/form crashes.
- **bug-0191** — Admin Next.js app missing security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) and `Cache-Control` on authenticated pages.
- **bug-0192** — `DirectLoginDto.password` has no `@MaxLength()` — scrypt DoS vector on unauthenticated login endpoint.
- **bug-0193** — No `app.enableShutdownHooks()` on auth-server — in-flight requests dropped on SIGTERM, Prisma connections leaked.
- **bug-0194** — `ValidationPipe` missing `forbidNonWhitelisted: true` — unknown request properties silently stripped.
- **bug-0195** — `accept-invite-form` has 4 hardcoded English validation messages bypassing i18n.
- **bug-0196** — UsersPage uses bare `Promise.all` and has no access-denied check — errors crash to generic error boundary.
- **bug-0197** — auth-server `tsconfig.json` missing `strict: true` — weaker type safety than other packages.
- **bug-0198** — `packages/db` `db:seed` script depends on `tsconfig-paths` without declaring it as a dependency.

#### Minor (12)

- **bug-0199** — `apps` server action `mapError` misattributes all 403s on create/update to "platform protected."
- **bug-0200** — `deleteUserAction` self-delete error detection is dead code (response body discarded by `apiFetch`).
- **bug-0201** — `createUserAction` `message.includes('already')` check is dead code.
- **bug-0202** — BetterAuth `auth` exported as `any` disables all TypeScript type checking.
- **bug-0203** — `FormField` hint text not linked to input via `aria-describedby`.
- **bug-0204** — `CardTitle` renders as `<div>` instead of `<h3>` — screen reader heading navigation skips cards.
- **bug-0205** — `RoleViewDrawer` shows edit/delete buttons regardless of `canWrite` permission.
- **bug-0206** — Stale `selected` state in table components after data refresh — drawers show outdated data.
- **bug-0207** — No `loading.tsx` for any admin route — no loading indicator during page navigation.
- **bug-0208** — Seed `else if` chain skips `publicId` backfill when `isSystem` also needs fixing.
- **bug-0209** — User enumeration via timing in `directLogin` (user-not-found fast path vs scrypt slow path).
- **bug-0210** — `bootstrap()` called without `.catch()` — startup failures may exit silently with code 0.

### Known open bugs

All previously tracked bugs remain open. The 9 critical bugs remain unfixed. Day 6 with zero commits and zero critical fixes merged. Total open bugs: 210 (188 prior + 22 new).

### Project health note

Today's multi-agent review (9 agents in parallel) found no new critical bugs — prior reviews have been thorough on the critical-severity surface. The findings concentrate in two areas: (1) **production hardening** — the auth-server lacks graceful shutdown, strict TypeScript, and request validation hardening; the admin app lacks security headers and cache controls. Four of these are one-line fixes (bug-0193, bug-0192, bug-0194, bug-0210). (2) **Error handling consistency** — the users page and its 5 server actions are the outliers in a codebase where other pages/actions handle errors consistently. bug-0189 (signOutAction) is the most user-impactful: a transient auth-server outage locks users out of the sign-out flow. The 7-day commit freeze with 9 critical bugs and 210 total open bugs is a sustained project health concern.

---

## [Unreleased] — 2026-07-06

No new commits in the last 24 hours. The last commit is `37f738a` (2026-07-01), reviewed across four prior daily reviews (2026-07-02 through 2026-07-05). Today's review is a **test infrastructure, configuration, and schema audit** covering: E2E test reliability/cleanup, RBAC matrix coverage gaps, environment variable validation, Prisma schema missing indexes, permissions service privilege escalation, invitation endpoint hardening, and admin type contract drift. 16 new bugs found (1 critical, 7 warning, 7 minor, 1 info). No bugs fixed.

### Bugs found (16 new)

See [BUGS_2026-07-06.md](./bugs/BUGS_2026-07-06.md) and [TODO_2026-07-06.md](./todo/TODO_2026-07-06.md).

#### Critical (1)

- **bug-0183** — `createPermission` allows `platform.*`-prefixed names — any admin with `platform.permissions.manage` can mint arbitrary platform privileges (privilege escalation).

#### Warning (7)

- **bug-0173** — E2E `afterAll` cleanup commented out — test data leaks across runs.
- **bug-0174** — Matrix harness missing `put()` method — PUT set-replace endpoints have zero RBAC matrix coverage.
- **bug-0175** — Social provider asymmetric env validation — app crashes if client ID set but secret missing.
- **bug-0179** — Missing database indexes on BetterAuth `Session.userId`, `Account.userId`, `Verification.identifier` — auth perf degrades linearly with table size.
- **bug-0184** — `AcceptInvitationDto` password has no `@MaxLength()` — hash-DoS on unauthenticated endpoint.
- **bug-0185** — `ADMIN_URL` silently falls back to `http://localhost:3001` for invitation emails — no startup warning.
- **bug-0186** — Admin `User` type declares phantom `lastLoginAt` and `createdAt` fields the API never returns.

#### Minor (7)

- **bug-0176** — No E2E coverage for `GET /api/invitations/:token` endpoint.
- **bug-0177** — No E2E coverage for `GET /api/me` and OAuth AS discovery document.
- **bug-0178** — Missing `prisma.$disconnect()` in matrix harness and scenario factory cleanup.
- **bug-0180** — `multitenant-visibility.spec.ts` fragile exact-count assertions coupled to seed data.
- **bug-0181** — Scenario factory uses `npx prisma` with relative path — fragile in CI.
- **bug-0187** — Redundant `@@index([token])` on `SaInvitation` — `@unique` already provides an index.
- **bug-0188** — LIKE wildcard characters (`%`, `_`) not escaped in search `q` parameter across all list endpoints.

#### Info (1)

- **bug-0182** — CORS E2E test coupled to implicit default `TRUSTED_ORIGINS` — no explicit env setup.

### Known open bugs

All previously tracked bugs remain open. The critical bug count rose from 8 to 9 with the discovery of **bug-0183** (privilege escalation via permission naming). Day 5 with zero commits and zero critical fixes merged. Total open bugs: 188 (172 prior + 16 new).

### Project health note

**bug-0183** is the most significant finding — it allows privilege escalation through the permission naming system. Combined with the existing bug-0096 (rename to `platform.*`), the permission system has two independent escalation vectors. **bug-0179** (missing BetterAuth indexes) is the highest-impact performance finding — authentication queries on Session, Account, and Verification tables fall back to sequential scans. **bug-0184** (password hash-DoS) is actionable with a one-line fix. The 5-day commit freeze with 9 critical bugs is a project health concern.

---

## [Unreleased] — 2026-07-05

No new commits in the last 24 hours. The last commit is `37f738a` (2026-07-01), already reviewed on 2026-07-02, deep-scanned on 2026-07-03, and multi-agent targeted on 2026-07-04. Today's review is a **cross-cutting sweep** of: resource server demo code correctness, admin middleware performance/availability, DTO validation gaps, UI component accessibility, and dead-code detection. 9 new bugs found (0 critical, 2 warning, 6 minor, 1 info). No bugs fixed.

### Bugs found (9 new)

See [BUGS_2026-07-05.md](./bugs/BUGS_2026-07-05.md) and [TODO_2026-07-05.md](./todo/TODO_2026-07-05.md).

#### Warning (2)

- **bug-0164** — `GET /api/apps/:id` endpoint is documented in README but missing from `AppsController` — no `getApp` route or service method exists.
- **bug-0165** — Admin middleware validates session on every request with no caching — each navigation triggers a full round-trip `fetch` to auth-server.

#### Minor (6)

- **bug-0166** — Admin middleware `fetch` to auth-server has no explicit timeout — if auth-server is slow, all admin requests hang.
- **bug-0167** — Resource server `GET /api/properties` requires `rs.properties.create` scope but README and seed data say `rs.properties.read`.
- **bug-0168** — `UpdateUserDto` allows empty strings for `firstName`, `lastName`, `username`, `phoneNumber` — no `@MinLength(1)`, unlike `CreateUserDto`.
- **bug-0169** — `CreateUserDto.email` has no `@MaxLength()` — arbitrarily long email strings accepted and stored.
- **bug-0170** — `FormField` component auto-generates IDs from label text — duplicate labels in the same form produce duplicate HTML IDs, breaking accessibility.
- **bug-0171** — Copy-to-clipboard handlers across all admin table/drawer components silently swallow clipboard API failures — no error feedback to user.

#### Info (1)

- **bug-0172** — `UsersTable` receives `initialOrgId` and `canPickOrg` props but immediately voids them — dead code from an unfinished feature.

### Known open bugs

All previously tracked bugs remain open. The 8 critical bugs (bug-0001, bug-0038, bug-0039, bug-0054, bug-0074, bug-0094, bug-0147, bug-0148) remain unfixed. Day 29 with zero critical fixes merged to production. Total open bugs: 172 (163 prior + 9 new).

### Project health note

No new commits for four consecutive days. Today's sweep focused on integration seams and validation gaps missed by prior targeted scans. **bug-0164** (missing getApp endpoint) is the most actionable — the README promises an endpoint that doesn't exist, which will confuse any developer building integrations. **bug-0165** (middleware session caching) is the most impactful at scale — every admin page load triggers at least one uncached fetch to the auth-server, adding latency to all authenticated requests. The DTO validation gaps (bug-0168, bug-0169) are straightforward one-line fixes but represent a parity gap between create and update DTOs. The resource server scope mismatch (bug-0167) affects the demo experience for anyone following the README.

---

## [Unreleased] — 2026-07-04

No new commits in the last 24 hours. The last commit is `37f738a` (2026-07-01), already reviewed on 2026-07-02 and deep-scanned on 2026-07-03. Today's review is a **multi-agent targeted scan** of: OAuth protocol compliance, token issuance security, BetterAuth session/cookie configuration, database schema integrity (uniqueness constraints, concurrency safety, orphaned records), production hardening (Helmet, Swagger gating), and admin component lifecycle. 17 new bugs found (2 critical, 8 warning, 6 minor, 1 info). No bugs fixed.

### Bugs found (17 new)

See [BUGS_2026-07-04.md](./bugs/BUGS_2026-07-04.md) and [TODO_2026-07-04.md](./todo/TODO_2026-07-04.md).

#### Critical (2)

- **bug-0147** — `username`/`phoneNumber` direct-login lookup uses `findFirst` on non-unique columns — `SaUser` has no `@@unique` on `username` or `phoneNumber`, so collisions across orgs cause cross-tenant authentication or incorrect rejection.
- **bug-0148** — All entity-creation flows race on a shared literal `publicId: 'placeholder'` — concurrent creates hit the unique constraint, producing wrong "name already exists" errors.

#### Warning (8)

- **bug-0149** — OAuth authorize returns JSON 401 to unauthenticated browser users instead of redirecting to login (RFC 6749 §4.1.1 violation).
- **bug-0150** — `redirect_uri` at `/token` is not bound to the code issued at `/authorize` (RFC 6749 §4.1.3 violation); only origin-level validation, no exact-match check.
- **bug-0151** — `deleteUser` only removes `SaUser` — BetterAuth `User`/`Account`/`Session` rows persist (email blocked, sessions live, credentials orphaned).
- **bug-0152** — `updateUser` allows `pending` → `active` without invitation acceptance, producing an active user with no credential.
- **bug-0153** — Swagger/OpenAPI docs (`/api/docs`) unconditionally exposed in all environments, no `NODE_ENV` gate.
- **bug-0154** — No Helmet security headers on any auth-server response.
- **bug-0155** — Uncancelled `setTimeout` for "copied" feedback state in 13 admin components — stale timers flip wrong row icons or fire after unmount.
- **bug-0156** — `SaUser`/`SaInvitation` publicIds derived from slicing a single UUID — correlated, not independently random, and inconsistent with the collision-safe `sqids.encode(id)` pattern used by all other models.

#### Minor (6)

- **bug-0157** — `TokenService.resolvePermissions` returns all user permissions unscoped by app — JWT `scope` claim lacks defense-in-depth filter.
- **bug-0158** — BetterAuth session lifetime and cookie security config entirely unconfigured — implicit library defaults only, fragile to `BETTER_AUTH_URL` misconfiguration.
- **bug-0159** — `NEXT_LOCALE` cookie has no `maxAge` — locale preference lost on browser close.
- **bug-0160** — Unmanaged `setTimeout` redirect timer in accept-invite flow.
- **bug-0161** — Seed script idempotency gap: partial BetterAuth `User` creation without `SaUser` is permanently unrecoverable by re-running seed.
- **bug-0162** — Duplicate deep permission-graph queries per request in user mutation endpoints (performance).

#### Info (1)

- **bug-0163** — Magic link/OTP dev callbacks log sensitive tokens to console with no production guard.

### Known open bugs

All previously tracked bugs remain open. The 8 critical bugs (bug-0001, bug-0038, bug-0039, bug-0054, bug-0074, bug-0094, bug-0147, bug-0148) remain unfixed. Day 28 with zero critical fixes merged to production. Total open bugs: 163 (146 prior + 17 new).

### Project health note

Today's multi-agent review (auth-server flows, admin client, DB schema) uncovered two new critical bugs. **bug-0147** (username/phone login collision) is the most impactful: any two users sharing a username across different orgs can collide on direct login, with `findFirst` returning an arbitrary match. **bug-0148** (placeholder publicId race) affects every entity-creation flow under concurrent use. bug-0151 (deleteUser orphaning BetterAuth rows) means "deleted" users retain live sessions and permanently consume their email address. On the production-hardening front, the Swagger docs, missing Helmet headers, unconfigured BetterAuth session settings, and magic-link/OTP dev callbacks combine into a weak production posture. The 13-component setTimeout timer pattern (bug-0155) is the most systematic admin-side finding — identical fix template applies to all.

---

## [Unreleased] — 2026-07-03

No new commits in the last 24 hours. The last commit is `37f738a` (2026-07-01), already reviewed on 2026-07-02. Today's review is a **deep codebase scan** of existing code on `master`, focused on race conditions, missing validation, error handling gaps, data integrity, and authorization. 11 new bugs found (5 warning, 6 minor). No bugs fixed.

### Bugs found (11 new)

See [BUGS_2026-07-03.md](./bugs/BUGS_2026-07-03.md) and [TODO_2026-07-03.md](./todo/TODO_2026-07-03.md).

#### Warning (5)

- **bug-0136** — `apiFetch` doesn't handle HTTP 401 — expired sessions show cryptic "API error 401" toasts instead of redirecting to `/login`.
- **bug-0137** — Table search/filter `useEffect`s in 4 table components lack `cancelled` flag — stale async responses can overwrite newer search results on slow networks.
- **bug-0138** — `removeRole` missing P2025 try-catch — returns raw 500 with Prisma stack trace when removing a role that isn't assigned.
- **bug-0139** — `resendInvitation` expire + create not wrapped in `$transaction` — partial failure orphans users with zero valid invitation tokens.
- **bug-0140** — `listUsers` returns unbounded results with no pagination — only list endpoint without `take`/`skip`.

#### Minor (6)

- **bug-0141** — `AppEditDrawer` and `OrgEditDrawer` allow whitespace-only name submission (create drawers validate, edit drawers don't).
- **bug-0142** — `UserViewDrawer` edit-mode `useEffect` missing `roles`/`directPermissions` in dependency array — stale closure can show empty role/permission editors.
- **bug-0143** — `deletePermission` P2003 guard unreachable due to cascade delete — permission deletion silently revokes all role/user assignments.
- **bug-0144** — `SaInvitation` model missing `@@index([expiresAt])` — expiry-based queries will degrade at scale.
- **bug-0145** — `PermissionViewDrawer` and `RoleViewDrawer` fetch effects have no cancellation guard — rapid drawer switching shows stale data.
- **bug-0146** — Sentry breadcrumb for `createUser` logs raw user email (PII) — all other breadcrumbs correctly use `publicId`.

### Known open bugs — no change

All previously tracked bugs remain open. The 6 critical bugs (bug-0001, bug-0038, bug-0039, bug-0054, bug-0074, bug-0094) remain unfixed. Day 27 with zero critical fixes merged to production. Total open bugs: 146 (135 prior + 11 new).

### Project health note

Today's deep scan uncovered systemic patterns across the codebase: (1) inconsistent `cancelled` flag usage in async `useEffect`s (6 components lack it), (2) create vs. edit drawer validation asymmetry, (3) missing error boundaries on auth pages, (4) `Promise.all` without `.catch()` in multiple admin drawers. The most impactful finding is bug-0140 (`listUsers` unbounded pagination) which is the only list endpoint without page/size limits. bug-0139 (`resendInvitation` non-atomic) and bug-0143 (`deletePermission` silent cascade) are the riskiest data integrity issues found.

---

## [Unreleased] — 2026-07-02

Daily review of commit `37f738a` (2026-07-01). One commit in the last 24 hours — a large single commit touching 45 files (+534 / -86 lines) shipping the Sonner toast + refresh UX across all admin CRUD paths, the `resolveIssuer()` DRY refactor for OAuth metadata, broadened roles read gates for the user admin page, scoped E2E `raceSuccessOrError` error detection, and docs cleanup. 5 new bugs found (1 warning, 3 minor, 1 info). bug-0129 (`SEED_DEMO_MULTITENANT` missing from `.env.example`) is now fixed.

### Fixed (from previous reviews)

- **bug-0129** — `.env.example` now includes `SEED_DEMO_MULTITENANT=` alongside `SEED_DEMO=`. Developers copying `.env.example` will discover the multi-tenant demo seed option.

### Bugs found (5 new)

See [BUGS_2026-07-02.md](./bugs/BUGS_2026-07-02.md) and [TODO_2026-07-02.md](./todo/TODO_2026-07-02.md).

#### Warning

- **bug-0131** — `raceSuccessOrError` success text check is unscoped — matches anywhere on the page, not just inside the Sonner toast container. Can false-positive if a table cell or page body contains the success text. Error detection is correctly scoped to `[data-sonner-toaster]` but success detection uses a bare `page.getByText()`.

#### Minor

- **bug-0132** — `user-create-drawer.tsx` uses raw `result.error` string for server errors instead of `result.errorKey` with `t()` like every other drawer, so server errors appear untranslated.
- **bug-0133** — `roles.service.spec.ts` double-awaits `rejects` on the same promise reference in the `deleteRole` P2003 test, which is unreliable across Jest versions.
- **bug-0134** — `permissions-matrix.ts` does not include an `apps.get` operation — the `apps` area defines list/create/update/delete but omits `get`, unlike orgs/roles/permissions which all define `get`.

#### Info

- **bug-0135** — `user-create-drawer.tsx` stale role/permission IDs on org switch — when the user changes the org dropdown, role options are refetched but previously selected `roleIds`/`directPermissionIds` are not cleared, so IDs from the previous org persist in form state.

### Known open bugs — no change

All previously tracked bugs remain open. Notable: bug-0112 (French toast i18n strings are untranslated English — 15 strings still in English in `fr.json`), bug-0126 (raceSuccessOrError null-outcome false positive), bug-0115 (`resolveIssuer()` accepts invalid URLs), bug-0116–0125. Total open bugs: 131 (130 prior - 1 fixed + 5 new - 3 duplicates of existing). Net: 131.

### Project health note

After today's review: 1 bug fixed (bug-0129), 5 new bugs found. The Sonner toast and refresh UX is a solid quality-of-life improvement. The `resolveIssuer()` DRY refactor correctly unifies the JWT `iss` claim and discovery `issuer` normalization. The E2E scoping fix for `raceSuccessOrError` addresses the Dev Tools `role="alert"` false-win, but the success-text unscoped check (bug-0131) and the existing null-outcome gap (bug-0126) remain. The 5 original critical bugs (bug-0001, bug-0038, bug-0039, bug-0054, bug-0074) remain open. Day 26 with zero critical fixes merged to production.

---

## [Unreleased] — 2026-07-01

Ships the toast/refresh admin UX, the OAuth issuer DRY refactor, and the E2E raceSuccessOrError scoping fix that had been accumulating on the working tree. Roles read gates broadened so the `/users` role picker works without a cross-page permission grant. Docs catch up on Flox, the multi-tenant demo seed, the `/.well-known/oauth-authorization-server` and `/api/me` endpoints, and the CR/BUGS/TODO daily-file convention.

### Added

#### admin — Toast notifications & post-mutation refresh
- **Sonner integration** — `sonner@^1.7.0` dependency; `<Toaster />` mounted in the root layout inside `ThemeProvider` and `NextIntlClientProvider`, forwards `next-themes` resolved theme so manual light/dark toggles take effect. (`apps/admin/components/toaster.tsx`, `apps/admin/app/layout.tsx`)
- **15 success toasts** on every CRUD path — create/update/delete for apps, orgs, permissions, roles, and users. All strings via i18n keys (`apps.toast.created`, `orgs.toast.updated`, …). Covers all 5 tables + 10 drawer variants.
- **`onSuccess?: () => void` prop** on every drawer (create + edit + view) so parent tables can pass a post-mutation refresh callback.
- **Table refresh helpers** — `apps-table`, `orgs-table`, `permissions-table`, `roles-table` each extract a `refresh` `useCallback` that re-fetches list data via the existing server action and is passed to their create/edit drawers. `users-table` uses `router.refresh()` since the Users page is a Server Component paired with `revalidatePath` in the mutating action.

#### auth-server — OAuth issuer resolution (DRY)
- **`resolveIssuer()` + `ISSUER_PLACEHOLDER`** exported from `oauth-metadata.ts`. Single source of truth for both the RFC 8414 discovery `issuer` field and the JWT `iss` claim, so the two cannot drift on a trailing slash or on the `https://auth.example.com` fallback. Strips a trailing slash from `BETTER_AUTH_URL` (RFC 8414 issuer matching is string-exact). (`apps/auth-server/src/token/oauth-metadata.ts`)
- **`NEST_GLOBAL_PREFIX` exported** — the `'api'` prefix is now defined once in `oauth-metadata.ts` and consumed by `configure-nest-app.ts`, replacing the previous duplicate string constant.
- **`DiscoveryController` startup warning** — logs a `console.warn` when `BETTER_AUTH_URL` is unset so a misconfigured prod deploy that would advertise the `https://auth.example.com` placeholder is observable. (`apps/auth-server/src/token/discovery.controller.ts`)
- **Test coverage** — `resolveIssuer()` unit tests (verbatim, trailing-slash strip, placeholder fallback, agreement between discovery + JWT paths); `DiscoveryController` startup-warn / no-warn tests. (`apps/auth-server/src/token/oauth-metadata.spec.ts`, `apps/auth-server/src/token/discovery.controller.spec.ts`)

#### docs
- **README — Flox quick-start** block pointing at `flox activate` for zero-config Node/pnpm/Postgres/Python provisioning. (`README.md`)
- **README — `SEED_DEMO_MULTITENANT`** documented (app01 + Acme/Globex orgs) alongside the existing `SEED_DEMO`.
- **README — API surface** now lists `GET /.well-known/oauth-authorization-server`, `GET /api/me`, and the `/oauth-error` admin route; adds a note that all admin CRUD flows show Sonner toasts.
- **README — Known Limitations** entry for `BETTER_AUTH_URL` not being validated at startup (bug-0115), and for the incomplete escalation-guard coverage on `removeRole` / `checkPermissionForApp` (bug-0094, bug-0097).
- **README — bug/CR paths** now reference `bugs/BUGS_*.md` and `todo/TODO_*.md` daily-file convention instead of the legacy `TODO.md` / `BUGs.md`.
- **`.env.example`** — adds `SEED_DEMO_MULTITENANT=` alongside `SEED_DEMO=`, so developers copying `.env.example` discover the multi-tenant demo seed.
- **`.gitignore`** — ignore `/.roborev/` snapshots.

### Changed

- **`TokenService.issueJwt`** — uses `resolveIssuer()` instead of inline `process.env.BETTER_AUTH_URL ?? 'https://auth.example.com'`, so the JWT `iss` claim and the discovery `issuer` field share the same normalization path. (`apps/auth-server/src/token/token.service.ts`)
- **`DiscoveryController.getOAuthAuthorizationServerMetadata`** — now calls `resolveIssuer()` (was reading `process.env.BETTER_AUTH_URL` directly). (`apps/auth-server/src/token/discovery.controller.ts`)
- **`RolesService.listRoles` / `getRole` read gates** — accept `platform.users.manage` in addition to `platform.roles.manage` / `org.roles.manage`, so the `/users` admin page can populate the role picker in the user-access drawer without needing a cross-page grant. Mirrors the orgs/permissions read pattern. Matrix test rotation and unit tests updated. (`apps/auth-server/src/roles/roles.service.ts`, `apps/auth-server/src/roles/roles.service.spec.ts`, `apps/auth-server/test/matrix/permissions-matrix.ts`)
- **`raceSuccessOrError` (E2E)** — all 5 admin-e2e page objects (`apps`, `orgs`, `permissions`, `roles`, `users`) scope error detection to `[data-sonner-toaster], [role="dialog"], [role="alertdialog"]` instead of the whole page. Next.js Dev Tools mounts a persistent empty `role="alert"` placeholder at the page root; a global `page.getByRole('alert')` matched it on every poll and made the error race always win.
- **OAuth authorize E2E route mock** — `oauth-authorize-flow.spec.ts` narrows the `page.route` stub from `${origin}/**` to exactly `origin === redirectUriOrigin && pathname === '/cb'`. The broad mock intercepted `/api/token/oauth/authorize` itself when `platformApp.url` shares the auth-server's origin (the default `BETTER_AUTH_URL=http://localhost:3000` case), causing the test to hang on the authorize endpoint with an empty body.
- **Playwright workers** — `CI_TESTS ? 1 : 1` (both branches serialize). Preserves the earlier local finding that Next.js dev-mode route compilation gets overwhelmed on cold-start parallel first-hits at 30s test timeout.

### Known open bugs

Daily bug/CR/TODO snapshots continue to live under `bugs/BUGS_*.md`, `code_reviews/CR_*.md`, and `todo/TODO_*.md`. Notable open items observed during the review window (bug-0112 … bug-0130) — French toast i18n untranslated (bug-0112), `refresh()` errors unhandled after mutations (bug-0114), `resolveIssuer()` accepts non-URL strings (bug-0115), `DeleteAlertDialog` error `<div>` missing `role="alert"` (bug-0120), `OrgsService` cross-tenant listing (bug-0121), double `stripTrailingSlash` (bug-0122) — remain open and are not addressed here.

---

## [Unreleased] — 2026-06-19

Massive day — 48 commits across two major feature branches (#114 feat/flox, #115 feat/org-scoped-admin), OAuth AS discovery, E2E fixes, and infrastructure cleanup. The org-scoped multi-tenant admin feature is the highlight: `SaPermission.isSystem`, app-scoped RBAC helpers, escalation guards, `GET /api/me` profile, permission-driven sidebar, and comprehensive scenario tests.

### Added

#### auth-server — Org-scoped multi-tenant administration (PR #115)

- **`SaPermission.isSystem` column** — new boolean column on permissions marking system-level perms that bypass app-scope checks. Migration sets `isSystem = true` on all `org.*` permissions. (`cc2c476`)
- **`checkPermissionForApp` helper** — app-scoped permission check for routes that operate within a single app's context. Non-platform permissions are rejected when the caller's app doesn't match the target app. (`b22f85f`)
- **`resolvePermissionIdsForApp`** honors `isSystem` flag — system permissions bypass the app-scope filter, allowing them to be assigned cross-app. (`efe06b3`)
- **`assertCallerCanGrantSystemPerms` escalation guard** — prevents privilege escalation by verifying the caller holds (directly or via roles) every system permission they're trying to grant. (`a4f6285`)
- **Escalation guard wired into user-assignment paths** — `assignRole`, `setUserRoles`, `setUserDirectPermissions`, and `createUser` all invoke the escalation guard before modifying grants. (`2a1c972`)
- **`GET /api/me` profile endpoint** — returns the caller's org, app context, and effective permissions for the admin UI's permission-driven behavior. (`f982259`)
- **Roles service: app-scoped gates** — `listRoles`/`createRole`/`updateRole`/`deleteRole` now check `platform.roles.manage` or `org.roles.manage` and scope reads by app. (`91f4a07`)
- **Permissions service: expose `isSystem`** — list and get responses include the `isSystem` flag. Immutability check extended to `isSystem` permissions. (`7424530`, `e7ee534`)
- **Orgs/permissions reads opened to `platform.users.manage`** — org-scoped admins with user management permission can now list orgs and permissions within their app scope. (`4e06f17`)
- **`SaRole @@unique([appId, name])` constraint** — role names are now enforced unique per app via DB constraint + migration. (`a13b1b7`)
- **Permission catalog migration** — split `platform.permissions.manage`, added `platform.roles.manage` + `org.roles.manage`, dropped `org.permissions.manage` with grant re-pointing. (`86d8a3a`)
- **Seed: `platform.roles.manage` + `org.roles.manage`** — new platform permissions seeded; added `r@sa.io` admin user. (`60a4912`)
- **Seed: `SEED_DEMO_MULTITENANT`** — new scenario creating `app01` with Acme and Globex orgs, 3 users each, with `org.users.manage` + `org.roles.manage` + custom app permissions. (`2e414f1`)

#### admin — Org-scoped UI (PR #115)

- **Permission-driven sidebar** — admin shell fetches `GET /api/me/permissions` and conditionally shows nav items based on the caller's effective permissions. (`4df9ee7`)
- **`getMyProfile` client** — `lib/api.ts` client helper for `GET /api/me`. (`b72dae7`)
- **`Permission.isSystem` type + System badge** — permissions table renders a "System" badge for `isSystem` permissions and locks edit/delete actions. (`b72dae7`, `0c5a67`)
- **Roles page: app-scoped** — non-platform callers see only their own app's roles; write affordances gated behind `canWrite`. (`c9d64aa`)
- **Users page: org-scoped default** — non-platform callers' Users page filters default to their own org. (`5999425`)
- **Sentry capture for /me failures** — `/api/me` fetch failures in the admin layout are reported to Sentry instead of silently swallowed. (`07f7d2a`)

#### auth-server — OAuth AS Discovery (latest on master)

- **`GET /.well-known/oauth-authorization-server`** — RFC 8414 OAuth Authorization Server metadata document exposing issuer, authorization/token/jwks endpoints, supported response types, grant types, and code challenge methods. (`4e06f17`)
- **`DiscoveryController`** — NestJS controller mounted outside the global prefix at `/.well-known/`. (`4e06f17`)

#### Flox environment (PR #114)

- **`.flox/env/manifest.toml`** — Flox environment with `nodejs_26`, `pnpm`, `postgresql`, `python311`, `uv`. (`6602267`)
- **Postgres service** — auto-provisioned via Flox services with `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` env vars. (`97c3b35`)
- **Auto-generate `.env.local`** — on first `flox activate`, generates RSA key pair, `BETTER_AUTH_SECRET`, and all other required env vars. (`97c3b35`)
- **Auto-run migrations and seed** — first activation runs `prisma migrate deploy` and `db:seed` automatically. (`1e1b34c`)

#### Testing

- **Multi-tenant scenario tests** — `bootScenarioApp` + demo-user helpers, visibility isolation spec (Acme/Globex admins see only their org's users), grant-ceiling spec (escalation guard blocks cross-permission-level grants). (`9d7c425`, `8962f65`, `20e2d7d`)
- **Migration verification test** — verifies `org.roles.manage` re-point and `org.permissions.manage` drop. (`3aef3e2`)
- **E2E multi-tenant tenant admin** — Playwright spec verifying tenant admin sees only their own org's users and scoped sidebar. (`c9910fd`)
- **Sidebar unit tests** — platform super, tenant admin, and single-perm holder sidebar visibility. (`477a536`)
- **Matrix test rotation** — updated for `platform.roles.manage` split. (`701ace6`)
- **Prisma binary resolution** — E2E tests now resolve prisma via absolute path instead of npx. (`1e22059`)

#### Infrastructure

- **Timestamped test results** — `scripts/log-test.mjs` writes test results to `test-results/` with timestamps. (`0370241`)
- **Code review files moved** — historical code review reports moved to `code_reviews/` directory. (`681bf68`)
- **`.gitignore` updates** — ignore `.claude/worktrees/`, `test-results/`, turbo watch config. (`70515ea`, `155d036`)

### Fixed

- **bug-0027 / bug-0078** — Role name uniqueness: `@@unique([appId, name])` constraint added via migration `20260618215604`. (`a13b1b7`)
- **E2E test fixes** — Playwright page objects refactored with `raceSuccessOrError` pattern, users page object expanded, Flox manifest fixes. (`ac648f6`)

### Bugs found (18 new)

See [TODO_2026-06-19.md](./todo/TODO_2026-06-19.md) and [BUGS_2026-06-19.md](./bugs/BUGS_2026-06-19.md).

#### Critical

- **bug-0094** — `checkPermissionForApp` silently grants access when `targetAppId` is undefined — any non-platform permission holder gets unconditional access.
- **bug-0099** — Migration 20260618220100 uses literal `publicId` strings that violate the unique constraint on re-run (partial migration recovery).
- **bug-0101** — `closeScenarioApp()` in the first scenario spec's `afterAll` tears down the shared NestJS server; second spec fails with `ERR_SERVER_NOT_RUNNING`.

#### Warning

- **bug-0095** — TOCTOU race in OAuth authorize vs code exchange: user's org/app membership not re-validated at code exchange.
- **bug-0096** — `updatePermission` allows renaming a non-platform permission to a `platform.*` prefix.
- **bug-0097** — `removeRole` has no escalation guard (asymmetric with `assignRole`).
- **bug-0098** — Migration isSystem bulk UPDATE affects all apps' `org.*` permissions, not just the platform app.
- **bug-0100** — New permissions from migration left with `pending-*` placeholder publicIds until the next seed.
- **bug-0102** — Grant-ceiling scenario tests are order-dependent with no teardown.
- **bug-0103** — `permissions-table.tsx` has no `canWrite` prop; edit/delete shown based on name heuristic only.
- **bug-0104** — `users-table.tsx` `initialOrgId`/`canPickOrg` props accepted but voided; org filtering non-functional.
- **bug-0105** — `permission-view-drawer.tsx` fetch error silently swallowed; sections appear empty with no feedback.
- **bug-0106** — Admin layout uses `notFound()` instead of `redirect('/login')` for unauthenticated sessions.
- **bug-0107** — `roles/page.tsx` throws raw `allSettled` rejection to error boundary, leaking API paths.
- **bug-0108** — `raceSuccessOrError` in E2E page objects resolves silently when both timeout (false positive).

#### Minor

- **bug-0109** — `playwright.config.ts` workers ternary is a dead branch (`CI_TESTS ? 1 : 1`).
- **bug-0110** — `roles.service.ts` `updateRole` missing null check after `findUnique` in transaction.
- **bug-0111** — `me.controller.ts` unsafe cast to extract `betterAuthUser` without optional chaining.

### Project health note

After today's review: 2 bugs fixed (bug-0027, bug-0078), 18 new bugs found. Net bug count: **109 open** (93 prior - 2 fixed + 18 new). The org-scoped admin feature is a significant architectural improvement, but the migration safety issues (bug-0098, bug-0099, bug-0100) and the escalation guard coverage gaps (bug-0094, bug-0096, bug-0097) should be addressed before deploying to a multi-tenant production environment. The 5 original critical bugs (bug-0001, bug-0038, bug-0039, bug-0054, bug-0074) remain open. Day 23 with zero fixes merged to production.

---

## [Unreleased] — 2026-06-18

- Apps: optional per-app `callbackUrl`. When set, the PKCE `redirect_uri` must
  match it exactly (trailing-slash tolerant); when blank, any callback under the
  app's URL origin is accepted (unchanged behavior).
- Apps: app and callback URLs now require https + a public host by default.
  Set `SASSY_AUTH_ALLOW_INSECURE_APP_URLS=true` to permit http/localhost URLs in
  development.

### Changed (palette/table-action-tooltips branch — PR #107, not merged)

4 commits by `google-labs-jules[bot]` on 2026-06-17 standardizing table row actions across the admin console:

- **Tooltip wrappers on all table "more actions" buttons** — `apps-table.tsx`, `orgs-table.tsx`, `permissions-table.tsx`, `roles-table.tsx`, `users-table.tsx` now wrap the `DropdownMenuTrigger` in a `<Tooltip>` with localized content via `t('common.moreActions')`.
- **Localized aria-labels** — hardcoded `aria-label="more actions"` replaced with `t('common.moreActions')` across all five tables. The users-table button previously had no `aria-label` at all.
- **`TooltipProvider` in root layout** — `apps/admin/app/layout.tsx` now wraps children in `<TooltipProvider>` inside `<NextIntlClientProvider>`.
- **New i18n keys** — `common.moreActions` added to `en.json` ("More actions") and `fr.json` ("Plus d'actions"). French translations for `common.save`, `common.edit`, `common.delete`, `common.confirm` fixed (were untranslated English).
- **Test infrastructure** — Global tooltip mocks added to `jest.setup.ts`; per-file mocks updated in all five table test files.
- **CI: build workspace packages** — `e2e.yml` now runs `pnpm exec turbo build --filter=!@sassy-auth/auth-server` before Prisma generate, ensuring `@sassy-auth/db` dist is available. Auth-server excluded due to pre-existing build errors.
- **Auth-server seed script** — `--transpile-only` flag added to `ts-node` in the seed script for faster execution (skips type checking).
- **Jules palette doc** — `.Jules/palette.md` added, documenting the tooltip/aria-label pattern and CI build dependency learning.

### Bugs found

See [TODO_2026-06-18.md](./todo/TODO_2026-06-18.md) and [BUGS_2026-06-18.md](./bugs/BUGS_2026-06-18.md).

#### Warning

- **bug-0090** — Jules bot created 6+ duplicate/overlapping PRs (#100–#109) for the same tooltip/loading-state task; only one should be merged.
- **bug-0091** — Auth-server `seed` script `--transpile-only` change bundled into a UI tooltip PR (#107); scope creep risks merge conflicts and masks seed type errors.
- **bug-0092** — CI `e2e.yml` excludes auth-server from `turbo build` due to "known pre-existing errors" — build failures are masked, not fixed.

#### Minor

- **bug-0093** — Global `jest.mock('@sassy-auth/ui')` in `jest.setup.ts` is fragile; file-level mocks in 5 test files completely override it, forcing every new test file to manually duplicate tooltip component mocks.

### Project health note

93 open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0089) remain empty — no implementation work has started. 5 critical bugs: RBAC isolation (bug-0001), JWT breaking change (bug-0038), in-memory OAuth codes (bug-0039), redirect_uri validation bypass (bug-0054), and inactive user auth bypass (bug-0074). Jules bot contributing duplicate PRs (#100–#109) adds to the backlog without fixing existing issues. Day 22 with zero fixes merged. Total open bugs: 93.

---

## [Unreleased] — 2026-06-07

No new code commits. Deep scan across auth-server token issuance, role/permission services, user service, admin UI components, Prisma schema constraints, and shared packages surfaced **16 new bugs** (1 critical, 9 warning, 6 minor).

### Bugs found

See [TODO_2026-06-07.md](./todo/TODO_2026-06-07.md) and [BUGS_2026-06-07.md](./bugs/BUGS_2026-06-07.md).

#### Critical

- **bug-0074** — Inactive/pending users can obtain JWTs via both OAuth and direct login. Neither flow checks `saUser.status` before issuing a token; setting a user to `inactive` has no effect on authentication.

#### Warning

- **bug-0075** — `listUsers` accepts `appPublicId` filter parameter but silently ignores it; callers get unfiltered results.
- **bug-0076** — `listRoles`/`getRole`/`listPermissions`/`getPermission` missing `targetOrgId` in checkPermission; org admins can list all roles/permissions cross-tenant.
- **bug-0077** — `assignRole`/`removeRole` (POST/DELETE) skip app-scoping validation, unlike the bulk `setUserRoles` (PUT) which validates via `resolveRoleIdsForApp`.
- **bug-0078** — `SaRole` lacks `@@unique([appId, name])` constraint; duplicate role names per app possible via concurrent requests.
- **bug-0079** — `SaPermission.name` globally unique instead of per-app `@@unique([appId, name])`; prevents same permission name across different apps.
- **bug-0080** — No rate limiting on `/api/token/direct/login` or `/api/invitations/:token`; brute-force attacks unthrottled.
- **bug-0081** — `UpdateUserDto` string fields lack `@MinLength`/`@MaxLength` constraints; empty strings and megabyte payloads accepted.
- **bug-0082** — `OauthTokenExchangeDto.client_secret` required by validation but never verified by controller; false sense of security.
- **bug-0083** — PrismaClient singleton has no reconnection strategy; DB connection drop causes sustained outage until process restart.

#### Minor

- **bug-0084** — `apiFetch` sends `Content-Type: application/json` on GET/DELETE with no body.
- **bug-0085** — User `publicId` generated via UUID truncation (12 chars) instead of Sqid pattern used by all other entities.
- **bug-0086** — `validateInvitation`/`acceptInvitation` duplicated in `api.ts` and `api-public.ts`; divergence risk.
- **bug-0087** — DataTable sort direction arrows lack `aria-label`; screen readers announce Unicode literals.
- **bug-0088** — `BreadcrumbPage` uses `role="link"` on non-interactive current-page element.
- **bug-0089** — Sidebar toggle shortcut (Ctrl+B) conflicts with browser bold formatting.

### Project health note

82 open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0073) remain empty — no implementation work has started. 5 critical bugs now: RBAC isolation (bug-0001), JWT breaking change (bug-0038), in-memory OAuth codes (bug-0039), redirect_uri validation bypass (bug-0054), and inactive user auth bypass (bug-0074). Day 12 with zero fixes merged. Total open bugs: 89.

---

## [Unreleased] — 2026-06-06

No new code commits. Deep scan across auth-server OAuth flow, admin server actions, Prisma schema, shared UI components, and middleware surfaced **20 new bugs** (1 critical, 13 warning, 6 minor).

### Bugs found

See [TODO_2026-06-06.md](./todo/TODO_2026-06-06.md) and [BUGS_2026-06-06.md](./bugs/BUGS_2026-06-06.md).

#### Critical

- **bug-0054** — `oauthAuthorize` does not validate `redirect_uri` against the app's registered URL. An attacker-supplied `redirect_uri` causes the authorization code to be redirected to an external domain (RFC 6749 section 10.6 violation).

#### Warning

- **bug-0055** — `deleteUser` orphans BetterAuth `User`, `Session`, and `Account` rows; email is locked and active sessions survive deletion.
- **bug-0056** — `setLocaleAction` does not validate the `locale` parameter; arbitrary value written to cookie, path traversal possible via dynamic import.
- **bug-0057** — `setLocaleAction` open redirect: `pathname` parameter passed directly to `redirect()` without validation.
- **bug-0058** — Users page has no permission check; any authenticated user can view all users across all orgs.
- **bug-0059** — `SaUser.username` and `phoneNumber` lack unique constraints; `directLogin` may authenticate as wrong user when usernames collide.
- **bug-0060** — `detectIdentifierType` phone regex misclassifies numeric usernames as phone numbers, causing silent login failures.
- **bug-0061** — `updateUserAction` is the only mutation action without error handling; throws unhandled exceptions.
- **bug-0062** — Seed script uses hardcoded password with no production guard.
- **bug-0063** — `SentryExceptionFilter` sends unsanitized request URL (including invitation tokens) to Sentry.
- **bug-0064** — Delete menu items in roles/permissions tables use `data-disabled` instead of Radix `disabled` prop.
- **bug-0065** — `signIn` action ignores `next` query parameter; always redirects to `/users`.
- **bug-0066** — DataTable sortable headers not keyboard-accessible (WCAG 2.1 SC 2.1.1 violation).
- **bug-0067** — Invitation endpoints accept any string as token without format validation.

#### Minor

- **bug-0068** — TOCTOU race in org/app update/delete operations (findUnique then mutate, not atomic).
- **bug-0069** — Middleware `PUBLIC_PATHS` prefix match allows unintended routes like `/login-anything` to bypass auth.
- **bug-0070** — Users table action buttons (Deactivate, Activate, Reset Password, Resend Invitation) are clickable no-ops.
- **bug-0071** — DataTable clickable rows not keyboard-accessible.
- **bug-0072** — `acceptInvitation` exposes raw API error messages to end users.
- **bug-0073** — OAuth authorization codes never purged from memory (abandoned flows leak).

### Project health note

46+ open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0053) remain empty — no implementation work has started. 4 critical bugs now: RBAC isolation (bug-0001), JWT breaking change (bug-0038), in-memory OAuth codes (bug-0039), and redirect_uri validation bypass (bug-0054). Day 11 with zero fixes merged. Total open bugs: 73.

---

## [Unreleased] — 2026-06-05

No new code commits. Targeted scan of the admin console client layer and component lifecycle patterns surfaced 4 new bugs (2 warning, 2 minor).

### Bugs found

See [TODO_2026-06-05.md](./todo/TODO_2026-06-05.md) and [BUGS_2026-06-05.md](./bugs/BUGS_2026-06-05.md).

- **bug-0050** — `apiFetch` discards auth-server error response bodies; admin UI shows generic "API error 400" instead of actionable messages like "Email already exists."
- **bug-0051** — `validateInvitation` includes raw invitation token in Error message strings, leaking to Sentry, error boundaries, and console.
- **bug-0052** — `getEffectivePermissions` client wrapper synthesizes `Permission` objects with `id: name` (a name string, not a Sqid) and `appId: ''`. Latent until inline actions are added.
- **bug-0053** — 10 admin components use `setTimeout` in click handlers without cleanup on unmount (9 drawer copy handlers + accept-invite form redirect).

### Project health note

31 open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0049) remain empty — no implementation work has started. 3 critical bugs (RBAC isolation, JWT breaking change, in-memory OAuth codes) block the PKCE feature branch from shipping. Day 10 with zero fixes merged.

---

## [Unreleased] — 2026-06-04

Quiet day — no new code commits landed. One docs-only commit (`b1ff9cf`) from the previous daily review. Targeted scan of existing code on `master` surfaced 2 new bugs.

### Bugs found

See [TODO_2026-06-04.md](./todo/TODO_2026-06-04.md) and [BUGS_2026-06-04.md](./bugs/BUGS_2026-06-04.md).

- **bug-0048** — Magic link URLs and OTP codes logged to `console.log` with no production guard; leaks authentication secrets to log aggregators.
- **bug-0049** — JWT token lifetime hardcoded to 3600 seconds (`token.service.ts:74`); not configurable via environment variable.

### Project health note

29 open PRs, 0 merged. All bug-fix branches (bug-0001 through bug-0047) remain empty — no implementation work has started. 3 critical bugs (RBAC isolation, JWT breaking change, in-memory OAuth codes) block the PKCE feature branch from shipping.

---

## [Unreleased] — 2026-06-03

OAuth2 PKCE (S256) shipped end-to-end on `docs/pkce-resource-server-design` — 8 implementation commits adding the authorize/token flow to auth-server, a FastAPI resource server reference app, login redirect support (`next=` URL), idempotent demo seed, and structured observability logs. The JWT payload saw a **breaking change**: the `permissions` array was replaced with a space-separated `scope` string to align with OAuth 2.0 conventions.

### Added

#### auth-server — OAuth2 PKCE (S256)
- **`/api/token/oauth/authorize`** now requires `code_challenge` + `code_challenge_method=S256` query params; rejects requests without PKCE. (`144c474`)
- **`/api/token/oauth/token`** accepts `code_verifier` instead of `client_secret`; verifies S256 challenge using `crypto.timingSafeEqual` for constant-time comparison. (`144c474`)
- **`OauthService.generateCode()`** stores `codeChallenge` and `codeChallengeMethod` alongside the authorization code (5-minute TTL). (`144c474`)
- **`OauthService.exchangeCode()`** verifies the verifier against the stored challenge; single-use (code deleted after exchange). (`144c474`)
- **`assertRedirectUriMatchesApp()`** — new origin-matching validator for `redirect_uri` against the app's registered URL. (`144c474`)
- **`redirect-uri.spec.ts`** — unit tests for origin matching including localhost, port mismatches, path permutations. (`144c474`)
- **E2E PKCE round-trip test** — authorize → token exchange → JWT verification with scope claim. (`9ae64e3`)
- **`IsUrl({ require_tld: false })`** on `OauthTokenExchangeDto.redirect_uri` to allow `localhost` redirect URIs during development. (`27d5ecf`)
- **JWT `scope` claim** — permissions now serialized as a space-separated string (`scope`) instead of a JSON array (`permissions`). Sorted alphabetically, deduplicated. (`144c474`)

#### auth-server — Observability
- **Structured logging** added to OAuth authorize, token exchange, PKCE verification failure, redirect URI rejection, and direct login success/failure paths. Uses Winston via `LoggerService`. (`d204515`)
- **Sentry tags** — `authFlow` and `appId` tags set on both OAuth and direct-login flows. (`d204515`)

#### auth-server — Demo seed
- **`seedDemoResourceServer()`** — idempotent seed for `resourceserver01` app: 2 roles (Property Managers, Inspectors), 8 `rs.*` permissions, 2 demo users. Gated behind `SEED_DEMO=1`. (`bf7673f`)

#### admin — Login redirect (`next=` URL)
- **`/login?next=<url>`** — login page accepts a `next` query parameter; after successful authentication, redirects to the validated URL instead of `/users`. (`4da3fa1`)
- **`validateNextUrl()`** — same-origin path validator with open-redirect mitigations (rejects `//`, `\`, `userinfo@` URLs, validates absolute URLs against an allowlist). (`4da3fa1`)
- **`safe-next.spec.ts`** — 9 test cases covering null/empty, same-origin paths, protocol-relative, backslash, absolute allowed/disallowed, userinfo, malformed, and env additions. (`4da3fa1`)

#### FastAPI resource server (`apps/resource-server-fastapi/`)
- **New app** — Python/FastAPI reference implementation showing how a resource server integrates with SassyAuth via PKCE. (`97f0f67`, `1637743`)
- **PKCE login flow** — `/auth/login` generates verifier/challenge, redirects to SassyAuth `/authorize`; `/auth/callback` exchanges code for JWT via `code_verifier`. (`1637743`)
- **JWKS token verification** — `PyJWKClient` with 10-minute cache, RS256 algorithm enforcement, audience/issuer validation, required claims check. (`1637743`)
- **`require_scope()` dependency** — FastAPI dependency that extracts Bearer token, verifies JWT, and checks scope. (`1637743`)
- **`/api/properties`** — sample protected endpoint requiring `rs.properties.read` scope. (`1637743`)
- **Test suite** — `test_pkce.py` (verifier/challenge generation), `test_verifier.py` (JWT verification + scope checks), `test_api_properties.py` (endpoint integration). (`1637743`)

#### Documentation
- **FastAPI resource server design spec.** (`a9eb300`)
- **FastAPI resource server implementation plan.** (`120a42c`)

### Changed (Breaking)
- **JWT payload** — `permissions: string[]` → `scope: string` (space-separated). Consumers must parse `decoded.scope.split(' ')` instead of `decoded.permissions`. (`144c474`)
- **`TokenErrorCode` enum** — `INVALID_CODE` and `CODE_EXPIRED` removed; replaced with standard OAuth error codes: `INVALID_REQUEST`, `INVALID_REDIRECT_URI`, `INVALID_GRANT`, `UNAUTHORIZED_CLIENT`. (`144c474`)
- **`SassyAuthJwtPayload` type** updated to match. (`144c474`)

### Fixed
- **localhost redirect URIs** — `IsUrl({ require_tld: false })` allows `http://localhost:8010/auth/callback` in the token exchange DTO. Previously, `@IsUrl()` required a TLD, blocking localhost development. (`27d5ecf`)

### Risky patterns / missing tests

See [TODO_2026-06-03.md](./todo/TODO_2026-06-03.md) and [BUGS_2026-06-03.md](./bugs/BUGS_2026-06-03.md).

- **bug-0038** — JWT `permissions` → `scope` is a breaking change with no migration path or version bump.
- **bug-0039** — In-memory authorization code storage lost on restart; blocks horizontal scaling.
- **bug-0040** — No garbage collection for expired codes; memory leak under sustained traffic.
- **bug-0041** — `code_verifier` and `code_challenge` lack RFC 7636 format validation.
- **bug-0042** — FastAPI resource server exposes access token to client-side JavaScript via `sessionStorage`.
- **bug-0043** — FastAPI JWKS verifier catches all exceptions generically; masks distinct failure modes.
- **bug-0044** — FastAPI scope parsing returns `{"None"}` when scope claim is `null`.
- **bug-0045** — Demo seed hardcodes ngrok URL and weak password instead of reading from env vars.
- **bug-0046** — No rate limiting on token exchange or FastAPI OAuth endpoints.
- **bug-0047** — `redirect_uri` allows all paths under the registered origin; no per-app path allowlist.

---

## [Unreleased] — 2026-06-02

User access management shipped end-to-end — 28 commits across auth-server (role + direct-permission set-replace APIs, atomic createUser), admin UI (3-axis user drawers, RoleRowsEditor), and the sidebar active-route highlight feature branch. All 9 bugs from the 2026-06-01 review (bug-0024 through bug-0032) were merged to master.

### Added

#### auth-server — User role + direct-permission management
- **`UsersService.setUserRoles()`** — set-replace endpoint that atomically swaps all roles for a user within their org's app scope. Wrapped in `$transaction`. (`06abf2d`)
- **`UsersService.getUserDirectPermissions()` + `setUserDirectPermissions()`** — read and set-replace direct permission assignments. (`59ea2e2`)
- **`createUser` expanded** — now accepts `roleIds` and `directPermissionIds` arrays, resolved and assigned atomically inside the creation transaction. (`1a1383e`)
- **`PUT /users/:id/roles`** — set-replace roles endpoint. (`8077cff`)
- **`GET /users/:id/direct-permissions`** — read direct permissions. (`8077cff`)
- **`PUT /users/:id/direct-permissions`** — set-replace direct permissions endpoint. (`8077cff`)
- **`SetUserRolesDto` + `SetUserDirectPermissionsDto`** — validation DTOs. (`a64a673`)
- **`resolveAppScopedIds` shared helper** — extracted from repeated app-scoped ID resolution logic into `common/permissions/`. (`360f3b4`)
- **E2E tests** for `PUT /users/:id/roles` and direct-permissions endpoints. (`aec78a1`)

#### admin — User access editing UI
- **`RoleRowsEditor`** — multi-row role picker primitive for inline role management in drawers. (`c780734`)
- **User create drawer** — supports N roles + N direct permissions via new editor components. (`5832b5e`)
- **User view drawer** — surfaces direct permissions read-only alongside roles and effective permissions. (`fbb0385`)
- **User edit drawer** — 3-axis editing: profile fields, role assignment, direct permission assignment. (`98abb49`)
- **API client helpers** — `setUserRoles()`, `getUserDirectPermissions()`, `setUserDirectPermissions()` added to `lib/api.ts`. (`6a28512`)
- **Server actions** — `setUserRolesAction()`, `setUserDirectPermissionsAction()`, `getUserDirectPermissionsAction()`. (`1b45c19`)
- **i18n** — role + direct-permission editor strings in en.json/fr.json. (`900e423`)
- **Unit tests** — create-drawer passes roleIds + directPermissionIds; view-drawer renders + edits direct perms and roles. (`aae7c7e`, `0e74bc3`)
- **E2E test** — Playwright covers user edit drawer direct-perm flow. (`2e9b851`)

#### Sidebar active-route highlight (in progress — `fix/sidebar-active-highlight`)
- **Design spec** for sidebar active-route highlight behavior. (`45def99`)
- **Implementation plan** for sidebar active-route highlight. (`5337b2a`)
- **E2E test** asserting sidebar highlights the active route across all 5 admin areas. (`18d1802`, `75b2fe7`)

#### Documentation
- **FastAPI resource server spec** — design spec for a FastAPI resource server with PKCE against SassyAuth. (`44a1fe6`)

### Fixed
- **accept-invite CORS + scrypt hashing** — fixed CORS for the accept-invite endpoint, switched to scrypt (via `better-auth/crypto`) for password hashing to match BetterAuth's verifier, and dropped the `bcryptjs` dependency. (`af9f4ca`)
- **SheetContent scroll** — added `flex flex-col` to `SheetContent` so `SheetBody` scrolls correctly when content overflows. (`8ae19b3`)
- **Profile-save error routing** — non-Error failures in user profile save now route through `t()` for i18n instead of crashing. (`7cbfc5a`)
- **Unused i18n keys** — dropped unused `users.fields.directPermission*` keys from message bundles. (`ae9772f`)
- **bug-0024 through bug-0032** — all 9 bugs from the 2026-06-01 review merged to master via `feat/test-coverage-campaign`. See [BUGS_2026-06-01.md](./bugs/BUGS_2026-06-01.md).

### Risky patterns / missing tests

See [TODO_2026-06-02.md](./todo/TODO_2026-06-02.md) and [BUGS_2026-06-02.md](./bugs/BUGS_2026-06-02.md).

- **bug-0033** — Sidebar `startsWith()` matching can false-positive on overlapping route prefixes.
- **bug-0034** — `SetUserRolesDto` / `SetUserDirectPermissionsDto` have no `@ArrayMaxSize` or empty-array guard.
- **bug-0035** — New user server actions repeat the brittle string-matching error pattern already fixed in bug-0032.
- **bug-0036** — `getUserDirectPermissions()` returns `appId: ''`, losing the app context for direct permissions.
- **bug-0037** — `TRUSTED_ORIGINS` is not validated at startup; malformed values silently break CORS.

---

## [Unreleased] — 2026-06-01

Massive day — 47 commits across three workstreams: (1) full permissions and roles CRUD on both auth-server and admin UI, (2) shadcn reskin of the admin console (sidebar, drawers, dark mode, AlertDialog), and (3) a test coverage campaign adding controller specs, service branch coverage, and the matrix E2E test infrastructure.

### Added

#### auth-server — Permissions CRUD
- **`PermissionsService`** with TDD spec — full CRUD (list with pagination/search/app-filter, get with role/user detail, create, update, delete) and `isPlatform()` guard preventing mutation of `platform.*` permissions. (`7f966df`, `34a5e34`)
- **`PermissionsController`** mounted at `/api/permissions` — 5 endpoints (GET list, GET :id, POST, PATCH :id, DELETE :id). (`34a5e34`)
- **Permissions DTOs** — `CreatePermissionDto`, `UpdatePermissionDto`, `ListPermissionsQueryDto` with `@Matches(NAME_REGEX)` validation for dotted lowercase names. (`16d113a`)

#### auth-server — Roles CRUD expansion
- **Role CRUD with permission management** — `RolesService` expanded from read-only to full CRUD: create role with permission IDs, update name/description/permissions atomically in a transaction, delete with user-assignment guard. (`379a1db`)
- **Roles DTOs** — `CreateRoleDto`, `UpdateRoleDto`, `ListRolesQueryDto`. (`379a1db`)

#### auth-server — Test coverage campaign
- **Controller specs** for all 6 modules: apps (4 endpoints), orgs (5), roles (5), permissions (5), users (10), me (2), invitations (2). (`4480256`, `b072cc5`, `ccac0ae`, `611c1c5`, `c9b955c`, `6d4c1c9`)
- **Service spec branch coverage gaps filled** — apps, invitations, orgs, permissions, roles, users service specs expanded with edge cases (P2002/P2003 handling, NotFoundException, ForbiddenException for platform resources). (`7cb727b`)
- **Coverage baseline captured** — 228 tests, 93.33% statement coverage. (`b6fa656`)
- **Matrix E2E test infrastructure** — Nest bootstrap + per-admin session helper (`harness.ts`), per-test data factories with LIFO cleanup queue (`factories.ts`), permissions-matrix single source of truth (`permissions-matrix.ts`). Spec files for all 5 resources created (placeholder `it.skip`). (`990e6cb`, `622a4ad`, `712dd4a`)
- **API & E2E test coverage campaign design spec and implementation plan**. (`61cbe30`, `e58efa7`)

#### admin — Permissions UI
- **`/permissions` route + server actions** — list, get, create, update, delete with error mapping and `revalidatePath`. (`fdfcfc1`, `c3ae5b9`)
- **PermissionsTable** — TanStack Table with search, app filter, pagination, row actions (view/edit/copy name/delete). (`fc3808c`)
- **PermissionCreateDrawer, PermissionEditDrawer, PermissionViewDrawer** — full drawer set with form validation, `NAME_REGEX` enforcement, role/user detail in view drawer. (`61559f2`, `5e8ca5a`, `83d5547`)
- **Permissions i18n** — `permissions.*` block in en.json and fr.json. (`35d7862`)
- **Permissions types + API client helpers**. (`997ef54`)
- **Permissions UI test suites** — 4 test files covering create, edit, view drawers and table. (`116081d`)

#### admin — Roles UI
- **`/roles` route + server actions** — list, get, create, update, delete, listAppPermissions. (`fb48d9c`)
- **RolesTable** — TanStack Table with search, app filter, pagination, row actions. (`52dd681`)
- **RoleCreateDrawer, RoleEditDrawer, RoleViewDrawer** — full drawer set. RoleCreateDrawer includes `PermissionRowsEditor` for inline permission management. (`255c386`, `e23b633`, `1541fa0`)
- **Roles i18n** — `roles.*` block in en.json and fr.json. (`6d81389`)
- **Role types + API helpers + user drawer migration** to shared types. (`177d757`)
- **Roles UI test suites** — 4 test files. (`529e8ff`)

#### admin — Shadcn reskin
- **Sidebar + light/dark theme toggle** — `SidebarShell`, `ThemeProvider`, `ThemeToggle`, `UserFooter` with icon-collapse mode. (`07fd7f4`, `c032520`)
- **Unified `PageHeader`** across Apps/Orgs/Users. (`c7e9d6b`)
- **`DeleteAlertDialog`** — shadcn AlertDialog for all delete confirmations, replacing inline confirms. (`7b3c477`)
- **Drawer + avatar reskin** — all 9 drawers (apps, orgs, users × create/edit/view) reskinned per slate/indigo palette. (`adff67d`)
- **Access-denied panel polish**. (`7726ba2`)
- **Design from variant.com** imported. (`3173bab`)

### Fixed

- **Effective-permissions API response shape** — admin `lib/api.ts` now unwraps the correct response envelope. (`63aa0ee`)
- **Pre-existing build + test breakage** — `server-only` mock, view-drawer test fix, Next.js config, package deps. (`db93252`)
- **Authenticated routes broken** — bumped `lucide-react`, pass icon names as strings across server/client boundary. (`df86a1e`)

### Risky patterns / missing tests

See [TODO_2026-06-01.md](./todo/TODO_2026-06-01.md) and [BUGS_2026-06-01.md](./bugs/BUGS_2026-06-01.md).

- **bug-0024** — Missing org/tenant isolation in `PermissionsService` — all operations check `platform.permissions.manage` but never pass `targetOrgId`.
- **bug-0025** — Missing org/tenant isolation in `RolesService` — same issue.
- **bug-0026** — Permission `name` unique constraint is global, not per-app (should be `@@unique([appId, name])`).
- **bug-0027** — Role `name` has no unique constraint at all (missing `@@unique([appId, name])`).
- **bug-0028** — Admin UI type narrowing uses weak `'publicId' in res` check instead of `'errorKey' in res` (3 instances).
- **bug-0029** — Role names have no input validation in admin UI (permissions require `NAME_REGEX`).
- **bug-0030** — Delete buttons in permissions/roles tables use `data-disabled` instead of HTML `disabled`, breaking keyboard navigation.
- **bug-0031** — Matrix test cleanup queue is module-scoped and never reset between test files, risking cross-spec pollution.
- **bug-0032** — Error mapping in admin server actions relies on brittle string matching against error messages.

---

## [Unreleased] — 2026-05-31

Light day — one critical cookie-encoding bugfix, the orgs-admin-ui feature branch merge, and design documentation for the upcoming shadcn reskin.

### Fixed

- **Session cookie double-encoding** — `parseSessionCookie()` now `decodeURIComponent`'s the cookie value before passing it to `cookieStore.set()`. Previously, base64 `=` padding arrived as `%3D` from upstream; Next.js's `cookie.serialize` re-encoded it to `%253D`, producing a 48-char signature instead of 44. BetterAuth's session lookup returned null, bouncing every page refresh back to `/login`. (`30de696`)

### Added

- **Admin nav E2E regression test** — `apps/admin-e2e/tests/authed/admin-nav.spec.ts` verifies a pre-authenticated session survives navigation to `/users`, hard refresh, `/apps`, and `/orgs`. Guards against the double-encoding regression and any future cookie-handling regressions. (`30de696`)
- **Shadcn reskin design spec** — `docs/superpowers/specs/2026-05-31-shadcn-reskin-design.md`: token system (slate/blue-600 palette), sidebar-first layout, component migration inventory (Button, Input, Select, Table, Sheet → shadcn equivalents), dark mode via `next-themes`. (`bbb2b5f`)
- **Shadcn reskin implementation plan** — `docs/superpowers/plans/2026-05-31-shadcn-reskin.md`: 30+ tasks covering shadcn CLI setup, package rewire, component-by-component migration, `AdminShell` sidebar rebuild, dark mode toggle, and QA. (`db5c613`, `a3e8e2a`)
- **Orgs admin UI branch merged** — `feat/orgs-admin-ui` and `orgs-admin-ui` branches merged to master, bringing in the daily code review report (`CR_2026-05-29.md`) and agent worktree references. (`2b8e3aa`, `51074b0`)

### Risky patterns / missing tests

See [TODO_2026-05-31.md](./todo/TODO_2026-05-31.md) and [BUGS_2026-05-31.md](./bugs/BUGS_2026-05-31.md).

- **bug-0022** — `decodeURIComponent` in `parseSessionCookie` can throw `URIError` on malformed percent-encoded values (no try-catch).
- **bug-0023** — `.claude/worktrees/agent-*` submodule references committed to git history via merge commit.

---

## [Unreleased] — 2026-05-29

Major e2e testing infrastructure day: the `admin-e2e` Playwright suite shipped end-to-end with CI, alongside auth fixes for Origin header forwarding and cookie attribute preservation. Design work started on the Orgs admin UI.

### Added

#### Admin E2E Test Suite (`apps/admin-e2e`)
- **New workspace package** `@sassy-auth/admin-e2e` bootstrapped with Playwright, chromium-only. (`eb44710`)
- **Login spec** verifying `s@sa.io` signs in and redirects to `/users`, with error-text-on-failure racing for clear diagnostics. (`0aef125`, `97226dc`)
- **`LoginPage` Page Object Model** with scoped submit button locator. (`1bceaf2`, `df72ad4`)
- **Auto-applied diagnostics fixture** attaching console logs, page errors, network failures, page HTML snapshot, and visible text on test failure. (`a138529`, `fad2862`)
- **i18n helper** reading admin `messages/en.json` for assertion text. (`5cf4891`, `3e3222b`)
- **Auth-state setup project** + `chromium-authed` project for future logged-in specs. (`f5456d8`, `c0f8548`)
- **Playwright config** with conditional `webServer` (CI spins up both servers; local assumes they are running). (`8ce75cd`, `08e7838`)
- **`data-testid="login-error"`** hook on admin login page for e2e selector stability. (`b2c6ab8`)

#### CI / DevOps
- **GitHub Actions e2e workflow** (`.github/workflows/e2e.yml`) with Postgres 16 service container, Prisma migration, RSA keypair generation, seed data, Playwright browser install, and artifact uploads for report/traces. (`06c9907`, `8f80906`)
- **Turbo `test:e2e` task** in `turbo.json` with passthrough env vars and no caching. (`3fd73ef`)

#### Documentation
- **Orgs admin UI design spec** mirroring the apps page. (`41be341`)
- **Admin E2E README** (`apps/admin-e2e/README.md`). (`c16079b`)
- **Playwright E2E design spec and implementation plan**. (`f717666`, `e45ba10`, `09840fc`)
- **BEGINNER_README.md** for junior developer onboarding. (`2f2760d`)
- **2026-05-28 code review** report. (`3caec0d`)

### Fixed

- **Origin header forwarding** — new `getForwardedOrigin()` helper (`apps/admin/lib/auth-origin.ts`) extracts the browser's Origin/Referer and forwards it on server-to-server BetterAuth calls. Fixes 403 errors from Undici's default `Sec-Fetch-Mode: cors` tripping BetterAuth's CSRF middleware. (`62e69b4`)
- **Trusted origins config** — `auth.config.ts` now reads `TRUSTED_ORIGINS` env var (comma-separated), defaulting to `http://localhost:3001`. (`644bc6d`)
- **Sign-out redirect** — `signOutAction()` now redirects to `/` instead of `/login`, letting the middleware handle the redirect chain. (`e17ec2e`)
- **Login soft failure** — `signIn()` catches transport-level errors (auth-server unreachable) and returns `serverUnavailable` error key instead of crashing. (`2fa5010`)
- **Cookie attribute preservation** — full `parseSessionCookie()` replaces the old regex-extract, preserving `Max-Age`, `Expires`, `Domain`, `Path`, `SameSite`, `HttpOnly`, and `Secure` from upstream `Set-Cookie`. Resolves bug-0013 from 05-27 review. (`2fa5010`)
- **Password verification** — direct-login flow now uses `better-auth/crypto` instead of raw bcrypt. (`f4bd89e`)
- **CI workflow** — test-results upload now gates on `steps.run-e2e.outcome == 'failure'`. (`8f80906`)
- **tsconfig noEmit** — `admin-e2e/tsconfig.json` uses `noEmit: true` to suppress stray `.js` emit. (`59a5de3`)

### Changed

- **`.gitignore`** — added `**/*.tsbuildinfo` glob; removed previously committed `apps/admin/tsconfig.tsbuildinfo`. (`ccce6d5`)
- **Root page redirect** — `apps/admin/app/page.tsx` now redirects authenticated users to `/users`. (`92c1638`)
- **Next.js dev indicators** repositioned via `next.config.ts`. (`5bda178`)
- **User drawer** — various fixes to drawer behavior, data fetching, and view-drawer test coverage. (`1b00820`)
- **Auth-server e2e tests** — extended to cover seeded super-admin flows. (`0ab856d`)
- **`api-public.ts`** — added unauthenticated fetch helper for public auth endpoints. (`b5c07d0`)

---

## [2026-05-28] — 2026-05-27

Heavy feature day across the monorepo (63 commits, all on `master`, local only — 12+ commits ahead of `origin/master` at time of writing). Three concurrent threads: full users/invitations/roles/orgs API surface on `auth-server`, the new `admin` Next.js console, and production-grade observability on both apps.

### Added

#### auth-server — Users / Invitations / Roles / Orgs API

- **`POST /api/users`** — create user + auto-generate invitation token (7-day expiry); wrapped in `$transaction` for atomicity. (`ce7bbc5`, `92ecc2c`)
- **`GET /api/users`, `GET /api/users/:id`** — list and read users with org/email enrichment. (`17b7348`)
- **`PATCH /api/users/:id`, `DELETE /api/users/:id`** — partial update (firstName, lastName, phoneNumber, username, status) and delete. (`6b5dbb3`)
- **`GET /api/users/:id/roles`, `GET /api/users/:id/effective-permissions`** — read role assignments and computed permission set (roles ∪ direct). (`d01e03b`)
- **`POST /api/users/:id/roles`, `DELETE /api/users/:id/roles/:roleId`** — assign and remove role on user. (`762e58b`)
- **`POST /api/users/:id/resend-invitation`** — expire prior unused tokens and mint a fresh one (pending users only). (`aefa396`)
- **`GET /api/invitations/:token`, `POST /api/invitations/:token`** — validate an invitation and accept it (creates BetterAuth `account` + activates `SaUser`); accept path wrapped in `$transaction`. (`8f9e144`, `10a6466`)
- **`GET /api/orgs`, `GET /api/roles`** — read-only listings for the admin console drop-downs. (`2d6c91b`)
- **DB schema:** `UserStatus` enum (`pending` / `active` / `inactive` / `suspended`), `status` field on `SaUser`, new `SaInvitation` model with unique token, `expiresAt`, `usedAt`. (`32b7d0f`, `3dd738c`)
- **`UsersModule` scaffold:** module wiring, DTOs (with `@IsNotEmpty`, `@MinLength`, `@IsEmail`), permission helper. (`633dfe7`, `0bc8bbf`)
- **OpenAPI spec** updated for the new endpoints and status field. (`a9a34d1`)

#### auth-server — Observability (Winston + Sentry)

- **Winston config + NestJS `LoggerService` adapter** with dev/prod transports (console + dev-only file). (`88880c1`)
- **`RequestIdMiddleware`** — propagates / generates `X-Request-Id`, decorates `req.requestId`, echoes in response header. (`495a133`)
- **`RequestLoggingMiddleware`** — per-request structured log line (method, URL, status, duration) with request-id correlation. (`72cffe1`)
- **`SentryExceptionFilter`** — global filter that forwards 5xx (and only 5xx) to Sentry while logging at level. (`87f45b8`)
- **Sentry bootstrap** in `src/instrument.ts` loaded before NestJS (OTel auto-instrumentation). (`87f45b8`, `49c1458`)
- **Structured event logs** added to `TokenController`, `UsersService`, `InvitationsService` (createUser / updated / deleted / role assigned-removed / invitation resent-accepted). (`a68f119`)
- **`.env.example` observability vars**: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `LOG_LEVEL`. (`85a0fb5`)

#### admin (new Next.js console)

- **Next.js app scaffold** with Tailwind v3, next-intl i18n (en/fr), `transpilePackages` for `@sassy-auth/ui`. (`719d69f`, `ca1b6dc`)
- **Auth middleware + `/login` page + Server Action** that proxies BetterAuth, forwards the session cookie. (`1a9ca0e`)
- **`AdminShell` layout** with sidebar, locale switcher, route group `(admin)`. (`d5df5e4`)
- **`/users` page** as a Server Component, `UsersTable` client component (TanStack Table). (`4995003`)
- **`UserViewDrawer`** — profile card, roles list, effective permissions, inline edit. (`d739c36`)
- **`UserCreateDrawer`** — create-user form, invite URL display + copy-to-clipboard, `createUserAction`. (`a3ebb15`)
- **`/accept-invite` page** — token validation (server) + password form (client). (`268e8d7`)
- **`lib/api.ts`** — session-forwarding `fetch` wrappers and shared types. (`fabacfa`)

#### admin — Observability

- **Sentry Next.js SDK setup** (client / server / edge configs) + `instrumentation.ts`. (`0e3d406`)
- **Global error boundary** (`app/global-error.tsx`) and **admin error boundary** (`app/(admin)/error.tsx`) both calling `Sentry.captureException`. (`42140ee`)
- **Breadcrumbs / user context** in `signIn` action, admin layout, `createUserAction`. (`f0e2a48`)
- **`.env.example` admin Sentry vars**: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`. (`a526b15`)

#### packages/ui — shared design system

- **`packages/ui` scaffold** with Tailwind tokens, CSS variables, `sideEffects` config. (`22418c8`, `640b2de`)
- **Primitives:** `Button`, `Badge`, `Input`, `Label`, `Select`, `StatusChip`, `UserAvatar`. (`2e7b225`)
- **`Table` + `DataTable`** (TanStack Table integration). (`7156e1f`)
- **`Sheet`, `DropdownMenu`, `FormField`** primitives. (`405f95c`)

#### Documentation

- Observability design spec (Winston + Sentry) + dev-mode file transports addendum. (`35c9955`, `5cd01e7`)
- Observability implementation plan (15 tasks). (`ee7fda6`)
- Admin UI brainstorming + design files (`designs/`). (`ff0f7ef`, `f95331f`)

### Fixed

- **`StatusChip` color**: convert to Tailwind class (was `style` prop). (`6dcd6d5`)
- **`SelectTrigger` focus-visible** ring restored. (`6dcd6d5`)
- **`SelectItemIndicator`** added. (`6dcd6d5`)
- **`react-dom` peer** declared on `packages/ui`. (`6dcd6d5`)
- **`packages/ui` `sideEffects`** and `accent` token added; `typecheck` script. (`640b2de`)
- **`packages/ui` CSS vars** — removed invalid `hsl()` wrappers around color tokens. (`67bed60`)
- **`UsersModule` registration** + `@IsNotEmpty` on DTOs. (`0bc8bbf`)
- **`createUser`** wrapped in `$transaction`; `publicId` derived from `baUserId.slice(...)`. (`92ecc2c`)
- **`acceptInvitation`** writes wrapped in `$transaction`. (`10a6466`)

### Internal

- Verify filter UI test added for users list. (`f2823c9`)
- Admin-ui superpowers plan checked in. (`72ee02f`)
- Max output tokens raised to 64k in `.claude/settings.local.json`. (`2791597`)

### Risky patterns / missing tests

See [TODO.md](./TODO.md) for the prioritized follow-up list and [BUGs.md](./BUGs.md) for the bug catalog. Three Critical-severity items must be resolved before this branch is shippable:

- **bug-0001** — RBAC isolation broken across orgs in `checkPermission`.
- **bug-0002** — Invitation tokens leak via request URL logs (and Sentry).
- **bug-0003** — Admin Next.js middleware accepts any non-empty cookie value.
