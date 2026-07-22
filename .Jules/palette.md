## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-22 - Checkbox Focus Outline Accessibility
**Learning:** Native checkbox inputs styled with customized colors (e.g. `accent-[var(--primary)]`) lack default browser focus indicators, which degrades accessibility for keyboard-only navigators (WCAG 2.1 Success Criteria 2.4.7 Focus Visible).
**Action:** Always append explicit focus ring utility styles (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`) when using native checkboxes.
