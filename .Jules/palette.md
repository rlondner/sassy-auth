## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-09 - Form Validation Split & Selection Rebasing
**Learning:** Checking multiple empty fields with a single generic validation message is highly misleading to users. Separating field checks into custom client-side validation triggers improves micro-UX and form clarity. Additionally, list tables displaying detail drawers must rebase active selected states on prop/route refresh so content updates are immediately visible in drawers.
**Action:** Separate individual client-side empty-field validations into distinct translation-backed errors; use `noValidate` on custom forms to prevent browser tooltips. Implement `useEffect` selection rebasing hooks on tables whose lists are updated via Next.js router refreshes.
