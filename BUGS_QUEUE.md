# Bug PR Queue — 2026-06-18

Triage of 35 open PRs. Most "open bug PRs" are obsolete because today's 13:15 mass-merge landed bug-0001..bug-0089 via a separate code path — the original `fix/bug-NNNN-*` branches still exist but their diffs vs `master` are now empty. Verified by grepping `origin/master` for each bug-NNNN commit.

The queue is sorted by **action**, not by bug number, so cleanup happens before real work.

---

## Bucket A — Close as obsolete (already in master)

Empty-diff PRs. Master has an equivalent `fix(bug-NNNN): …` commit landed today; the branch commit is a duplicate. Close PR, delete remote branch.

| PR  | Branch                                        | Master commit | Action          |
| --- | --------------------------------------------- | ------------- | --------------- |
| #17 | fix/bug-0016-env-var-test-credentials         | 7ea6c11       | close + delete  |
| #23 | fix/bug-0022-decode-uri-try-catch             | 9ccaa00       | close + delete  |
| #24 | fix/bug-0023-remove-agent-worktree-refs       | 5b3a576       | close + delete  |
| #26 | fix/bug-0024-permissions-tenant-isolation     | f8cb355       | close + delete  |
| #27 | fix/bug-0025-roles-tenant-isolation           | 072ad5b       | close + delete  |
| #28 | fix/bug-0026-permission-name-unique-per-app   | 77fab18       | close + delete  |
| #31 | fix/bug-0029-role-name-validation             | ba66b80       | close + delete  |
| #32 | fix/bug-0030-delete-button-a11y               | a463801       | close + delete  |
| #33 | fix/bug-0031-matrix-cleanup-isolation         | b0ae4d2       | close + delete  |
| #34 | fix/bug-0032-error-mapping-brittle            | 989f005       | close + delete  |

**One command** to handle the bucket:

```bash
for n in 17 23 24 26 27 28 31 32 33 34; do
  gh pr close $n --comment "Superseded by direct commit on master from the 2026-06-18 mass-merge. Branch diff is empty." --delete-branch
done
```

---

## Bucket B — Close as duplicates (palette pile-up)

15 redundant `palette/*` PRs all attempting the same two tasks (loading state, tooltip standardization). Per `bugs/BUGS_2026-06-18.md#bug-0090`, the agreed surviving PRs are:

- **Keep #22** — `palette/ux-accessibility-fixes` (SUCCESS CI, broadest a11y scope)
- **Keep #25** — `palette/button-loading-state-…` (SUCCESS CI, Button + ConfirmDialog)
- **Keep #107** — `palette/table-action-tooltips-…` (BUGS doc names it as the canonical tooltip PR)

**Close these 15**:

| PR   | Title (truncated)                                          |
| ---- | ---------------------------------------------------------- |
| #35  | Add loading state to Button component                      |
| #42  | Micro-UX improvements for loading states and accessibility |
| #44  | Standardize Button loading state                           |
| #57  | Standardize Button loading state                           |
| #62  | Add standardized loading state to buttons                  |
| #99  | Standardized Button Loading State                          |
| #100 | Standardized Loading States and Accessibility Improvements |
| #101 | Unified loading states for UI components                   |
| #102 | Standardize loading states in confirmation dialogs         |
| #103 | Standardized loading states for buttons and dialogs        |
| #104 | Improve 'more actions' accessibility and tooltips          |
| #105 | Standardize and enhance loading states                     |
| #106 | Standardize row action tooltips and accessibility          |
| #108 | Standardize table row actions with tooltips and localized  |
| #109 | Standardize table row actions with tooltips and ARIA labels|

```bash
for n in 35 42 44 57 62 99 100 101 102 103 104 105 106 108 109; do
  gh pr close $n --comment "Duplicate of #22 / #25 / #107 per BUGS_2026-06-18.md bug-0090. Closing to clear backlog." --delete-branch
done
```

> Bucket A + B together = **25 PRs closed in two commands, zero code changes.**

---

## Bucket C — Real work, one at a time

PRs with non-empty diffs whose fix is NOT yet in master. Tackle in order. Each gets its own `/loop`-style cycle: checkout → rebase on master → verify → push → merge.

### C1. #18 — fix(bug-0018): validate TRUSTED_ORIGINS at startup
- Branch: `fix/bug-0018-validate-trusted-origins`
- Diff: 2937 additions / 2 deletions across 3 files (likely stale rebase — only the actual fix is a few lines; rest is master moving on).
- **Step 1:** rebase on master, confirm the real diff is small.
- **Step 2:** run auth-server unit + e2e tests.
- **Note:** there is a *similar* but distinct merged fix `bug-0037` (`fix(bug-0037): validate TRUSTED_ORIGINS at startup`, PR #40). Verify bug-0018 isn't actually duplicate before doing work — if it is, move to Bucket A.

### C2. #19 — fix(bug-0017): handle null parseSessionCookie result
- Branch: `fix/bug-0017-cookie-parse-null-handling`
- Diff: 2944/13 across 3 files (stale rebase).
- Not in master (verified).
- Small null-guard fix. Should be a 5-line change after rebase.

### C3. #20 — fix(bug-0019): centralize AUTH_SERVER_URL default
- Branch: `fix/bug-0019-centralize-auth-server-url`
- Diff: 2934/7 across 6 files (stale rebase).
- Not in master (verified).
- Refactor that touches several call sites — re-check that none have drifted under master.

### C4. #21 — fix(bug-0020): document cookie parser regex limitation
- Branch: `fix/bug-0020-cookie-parser-edge-case-docs`
- Diff: 5/0 across 1 file (docs only).
- Smallest item in the queue — likely a 2-minute merge if CI passes.

---

## Bucket D — Placeholder PRs that need actual work

Branches with only `chore: placeholder for …` commits. The bug entries are real (see `bugs/BUGS_2026-06-18.md`) but no fix code has been written yet.

| PR   | Bug      | Topic                                              | Est. effort |
| ---- | -------- | -------------------------------------------------- | ----------- |
| #110 | bug-0090 | Close duplicate Jules bot PRs                      | None — Bucket B above already executes this. After Bucket B is done, close #110 as completed-by-housekeeping. |
| #111 | bug-0091 | Revert auth-server seed `--transpile-only` change  | 5 min — revert one line in `apps/auth-server/package.json` on the `palette/table-action-tooltips` (#107) branch. |
| #112 | bug-0092 | Fix auth-server build errors instead of CI exclude | Unknown — needs investigation. Run `pnpm --filter @sassy-auth/auth-server build` first. |
| #113 | bug-0093 | Extract shared `@sassy-auth/ui` jest mock factory  | 20 min — code laid out in BUGS_2026-06-18.md§bug-0093. |

---

## Suggested run order

1. **Bucket A** (one command, 10 PRs closed).
2. **Bucket B** (one command, 15 PRs closed).
3. **Bucket C** sequential: C4 → C2 → C3 → C1 (easiest → trickiest, smallest deps first).
4. **Bucket D** sequential: 110 → 111 → 113 → 112.

After each Bucket C/D item, say **"next"** and I'll move to the following one.

---

## Open questions for you

1. **Bucket A authorization** — OK to run the close-and-delete loop for the 10 obsolete PRs without inspecting each individually? I've verified each has a corresponding `fix(bug-NNNN): …` commit on `origin/master`.
2. **Bucket B authorization** — OK to close the 15 duplicate palette PRs in one shot? The BUGS doc already named the survivors (#22, #25, #107).
3. **C1 (#18) vs bug-0037** — should I treat #18 as a likely duplicate of merged bug-0037 (and move it to Bucket A if confirmed) without asking again?
4. **Branch cleanup** — many of the ~75 `fix/bug-NNNN-*` branches whose PRs are already merged still exist on origin. Want me to prune those at the end as a separate housekeeping step?
