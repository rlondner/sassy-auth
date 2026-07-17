## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-17 - Keyboard Focus States on Native Elements
**Learning:** Raw input elements (such as `type="checkbox"`) used inside custom forms or drawers often lack focus-visible keyboard styling by default, violating WCAG keyboard accessibility standards.
**Action:** Always ensure native form elements are styled with Tailwind's focus-visible utilities (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`) to provide clear visual feedback during keyboard navigation.
