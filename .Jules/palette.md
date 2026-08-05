## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-08-05 - Secure Text Positioning for Input Overlays
**Learning:** High-contrast, interactive show/hide password buttons must use precise relative positioning (`relative` + `absolute right-X`) and padding (`pr-10`) to prevent the hidden password characters from overlapping the interactive button.
**Action:** Always add trailing horizontal padding (`pr-10`) to input elements hosting interactive icon buttons inside them.
