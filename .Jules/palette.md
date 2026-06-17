## 2026-05-30 - [Standardizing Table Row Actions]
**Learning:** Icon-only buttons (like the `more_vert` row action button) require both a localized `aria-label` for screen readers and a `Tooltip` for sighted users to ensure full accessibility and a polished UX. When implementing Tooltips in components, global Jest mocks must be updated to avoid `TooltipProvider` context errors in existing tests.
**Action:** Always wrap `more_vert` buttons in a `Tooltip`, use `common.moreActions` for both label and tooltip content, and ensure `Tooltip` components are mocked in `jest.setup.ts` or individual test files.

## 2026-05-30 - [pnpm version conflict in GitHub Actions]
**Learning:** In GitHub Actions workflows, 'pnpm/action-setup@v4' must not specify a 'version' property if the root 'package.json' defines 'packageManager' (e.g. "packageManager": "pnpm@9.0.0"). Doing so causes 'ERR_PNPM_BAD_PM_VERSION' and job failure due to multiple version specifications.
**Action:** Remove `version` property from `pnpm/action-setup` in workflows when `packageManager` is present in `package.json`.
