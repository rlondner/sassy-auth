## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-10 - Keyboard Accessibility for Checkboxes
**Learning:** Native HTML checkboxes in the application had missing focus-visible indicators, which made keyboard-only navigation extremely difficult because the user could not visually track the focused state of the element.
**Action:** Always configure standardized keyboard focus states on all native HTML input checkboxes using Tailwind's `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` classes to comply with WCAG 2.1 focus visible guidelines.
