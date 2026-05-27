# Bug Catalog

Bugs surfaced by the **2026-05-27 daily code review** of `master` (HEAD `a526b15`, 12+ commits ahead of `origin/master`). Each entry has a stable `bug-NNNN` id used in branch names and PR titles.

Severity legend:
- 🔴 **Critical** — blocks shipping; tenant isolation, credential leakage, or auth bypass.
- 🟡 **Warning** — fix soon; correctness or privacy gap.
- 🔵 **Minor** — small correctness / lint hygiene.
- ⚪ **Info** — advisory, not actionable mechanically.

Cross-references the longer narrative in `CR-05-27-2026.md`.

---

## 🔵 bug-0014 — `UserCreateDrawer` effect missing `orgs` / `getRoles` deps

**Fixed:** true
**Severity:** Minor
**File:** `apps/admin/components/user-create-drawer.tsx`
**Commit:** `a3ebb15`

**Description.** `React.useEffect(..., [form.orgId])` will trip `react-hooks/exhaustive-deps`. `orgs` and `getRoles` are stable in practice; adding them keeps the lint clean.

**Fix sketch.** Add the missing deps; alternatively memoize `getRoles` with `useCallback`.

---

## Summary

| ID | Severity | PR planned |
|----|----------|------------|
| bug-0001 | 🔴 Critical | ✅ |
| bug-0002 | 🔴 Critical | ✅ |
| bug-0003 | 🔴 Critical | ✅ |
| bug-0004 | 🟡 Warning  | ✅ |
| bug-0005 | 🟡 Warning  | ✅ |
| bug-0006 | 🟡 Warning  | ✅ |
| bug-0007 | 🟡 Warning  | ✅ |
| bug-0008 | 🟡 Warning  | ❌ (advisory — TODO.md) |
| bug-0009 | 🟡 Warning  | ✅ |
| bug-0010 | 🟡 Warning  | ❌ (config audit — TODO.md) |
| bug-0011 | 🟡 Warning  | ✅ |
| bug-0012 | 🟡 Warning  | ✅ |
| bug-0013 | 🟡 Warning  | ✅ |
| bug-0014 | 🔵 Minor    | ✅ |
| bug-0015 | ⚪ Info     | ❌ (out of scope) |

PR convention: `fix/bug-NNNN-<short-name>` branch, `fix(bug-NNNN): <summary>` PR title.
