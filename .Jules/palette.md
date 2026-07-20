## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-20 - Localizing System Tool/Utility Errors
**Learning:** Even client-side system utility/feedback hooks (like `useCopyFeedback` clipboard copy failure notification toasts) must be internationalized to prevent English/French mixed languages in localization environments.
**Action:** Use `next-intl`'s `useTranslations` inside utility and feedback hooks to ensure any thrown toast or error alerts align with the active user locale.
