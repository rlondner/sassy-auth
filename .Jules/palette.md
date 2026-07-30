## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-30 - Localizing Core Generic Actions & Toasts
**Learning:** Generic actions (e.g. Save, Edit, Delete, Confirm) and temporary feedback (e.g. Toast notifications) must be fully localized to prevent fallback language mismatch, ensuring a continuous and professional multilingual user experience.
**Action:** Audit and backfill translations for common interactive buttons and quick feedback elements (like toasts) when supporting non-English locales.
