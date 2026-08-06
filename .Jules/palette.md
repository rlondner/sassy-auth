## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-08-06 - Focus-Visible Native Checkboxes and Share Link Input Selection
**Learning:** Native input elements (like checkboxes and read-only text fields) in Next.js/Tailwind components often lack visible focus styles, violating WCAG standards. Adding `focus-visible` rings guarantees keyboard navigation compliance. Furthermore, auto-selecting read-only share-link URLs on focus/click dramatically simplifies clipboard copying without interrupting tab index flow.
**Action:** Always verify that native HTML input elements (especially checkboxes) feature appropriate `focus-visible:ring-2` styles and use standard browser interaction patterns (like `e.target.select()`) for read-only URLs.
