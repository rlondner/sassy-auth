## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-08-11 - Accessible and Localized Form Validation Display
**Learning:** Standardizing forms using a robust, shared `FormField` component over raw HTML tags provides automatic ID generation and screen-reader compliant `aria-describedby` associations. Furthermore, enforcing custom client-side validation using the `noValidate` attribute prevents inconsistent browser tooltips and allows for precise localized required-field messaging (e.g. distinguishing name and URL validation errors).
**Action:** Use `FormField` for all input fields, and implement manual client-side validations with distinct translation error keys in conjunction with form-level `noValidate` attributes.
