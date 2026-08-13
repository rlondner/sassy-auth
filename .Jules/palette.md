## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-08-13 - Localized Accessible Tooltips on Table Actions
**Learning:** Icon-only row actions and copy buttons lack clear semantic meaning for screen readers and can be ambiguous. Wrapping them in semantic Radix Tooltips with dynamic localized labels (`aria-label`) ensures WCAG 2.1 Focus Visible and Name/Role/Value standards are strictly met while providing delightful visual feedback.
**Action:** Ensure table copy triggers and action triggers are nested in Tooltips and have explicit, localized `aria-label`s.
