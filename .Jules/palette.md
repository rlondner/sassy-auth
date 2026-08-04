## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-08-04 - Table Actions Keyboard Accessibility & Tooltips
**Learning:** Icon-only interactive elements in table rows (such as copy-to-clipboard public ID buttons and three-dot row action trigger buttons) require explicit, standardized tooltip wraps and custom `focus-visible` styles to guarantee compliance with WCAG Focus Visible keyboard-accessibility standards.
**Action:** Always wrap row-level icon buttons with `<Tooltip>` from `@sassy-auth/ui` and apply standard Tailwind focus states (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`).
