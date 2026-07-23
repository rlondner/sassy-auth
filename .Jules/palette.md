## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-23 - Focus States for Native Checkboxes
**Learning:** Native HTML input elements (such as `type="checkbox"`) lack keyboard focus outlines by default under custom CSS resets, violating WCAG 2.1 AA keyboard navigation standards.
**Action:** Always add explicit keyboard focus indicators (e.g., `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`) to native inputs when used directly instead of styled wrapper components.
