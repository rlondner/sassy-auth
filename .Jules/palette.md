## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-08-07 - Interactive Selection on Read-only Link Dialogs
**Learning:** Read-only sharing inputs can be frustrating to copy if selecting text requires manual dragging. Combining automatic selection on focus/click with accessible focus-visible indicator outlines ensures rapid copying and satisfies WCAG Focus Visible requirements.
**Action:** Always bind `onFocus` and `onClick` with `e.target.select()` on read-only copy inputs, and style them with clear, keyboard-only focus ring outlines (`focus-visible:ring-2`).
