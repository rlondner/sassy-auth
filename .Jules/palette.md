## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-14 - FormField Label and Test Matching
**Learning:** The `FormField` component with `required={true}` appends a `*` to the label string. Standard `screen.getByLabelText('Label')` will fail because of the extra character.
**Action:** Use regex (e.g., `/Label/`) or `{ exact: false }` when querying for labels of required fields in unit tests.
